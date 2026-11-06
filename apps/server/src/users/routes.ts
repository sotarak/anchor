import { type UserDto, updateUserBodySchema } from "@anchor/shared";
import { type Context, Hono } from "hono";
import { recordAudit } from "../audit/record";
import { requireUser } from "../auth/middleware";
import { revokeUserSessions } from "../auth/sessions";
import { authorize } from "../authz/policy";
import type { AppEnv, UserPrincipal } from "../env";
import { ApiError } from "../lib/errors";
import { parseJson } from "../lib/validate";
import {
  deleteUserGuarded,
  findUserById,
  listUsers,
  toUserDto,
  type UserRow,
  updateUserGuarded,
} from "./repo";

/** Mounted at /api/v1/users. Instance owners and admins, user sessions only. */
export const userRoutes = new Hono<AppEnv>();

const LAST_OWNER = "An instance must keep at least one active owner";

async function userManager(c: Context<AppEnv>): Promise<UserPrincipal> {
  const principal = requireUser(c);
  await authorize(c.env.DB, principal, "user:manage");
  return principal;
}

async function targetUser(c: Context<AppEnv>): Promise<UserRow> {
  const target = await findUserById(c.env.DB, c.req.param("id") ?? "");
  if (!target) throw new ApiError(404, "not_found", "User not found");
  return target;
}

/** Only owners may touch an owner account or grant the owner role. */
function assertMayManage(actor: UserPrincipal, target: UserRow, newRole?: string): void {
  if (actor.role !== "owner" && (target.role === "owner" || newRole === "owner")) {
    throw new ApiError(403, "forbidden", "Only an owner can manage owners");
  }
}

userRoutes.get("/", async (c) => {
  await userManager(c);
  const users = await listUsers(c.env.DB);
  return c.json<{ users: UserDto[] }>({ users: users.map(toUserDto) });
});

userRoutes.patch("/:id", async (c) => {
  const actor = await userManager(c);
  const body = await parseJson(c, updateUserBodySchema);
  const target = await targetUser(c);
  if (target.id === actor.userId && body.disabled === true) {
    throw new ApiError(409, "conflict", "You cannot disable yourself");
  }
  assertMayManage(actor, target, body.role);
  const now = Date.now();
  const disabledAt = body.disabled === undefined ? undefined : body.disabled ? now : null;
  const outcome = await updateUserGuarded(
    c.env.DB,
    target.id,
    { role: body.role, disabledAt },
    now,
  );
  if (outcome === "not_found") throw new ApiError(404, "not_found", "User not found");
  if (outcome === "last_owner") throw new ApiError(409, "conflict", LAST_OWNER);
  if (body.disabled === true) await revokeUserSessions(c.env.DB, target.id);
  await recordAudit(c, {
    action: "user.updated",
    target: target.id,
    metadata: {
      userId: target.id,
      ...(body.role !== undefined && { role: body.role }),
      ...(body.disabled !== undefined && { disabled: body.disabled }),
    },
  });
  const updated = await findUserById(c.env.DB, target.id);
  if (!updated) throw new ApiError(404, "not_found", "User not found");
  return c.json<{ user: UserDto }>({ user: toUserDto(updated) });
});

userRoutes.delete("/:id", async (c) => {
  const actor = await userManager(c);
  const target = await targetUser(c);
  if (target.id === actor.userId) throw new ApiError(409, "conflict", "You cannot delete yourself");
  assertMayManage(actor, target);
  const outcome = await deleteUserGuarded(c.env.DB, target.id);
  if (outcome === "not_found") throw new ApiError(404, "not_found", "User not found");
  if (outcome === "last_owner") throw new ApiError(409, "conflict", LAST_OWNER);
  await recordAudit(c, {
    action: "user.deleted",
    target: target.id,
    metadata: { userId: target.id, email: target.email },
  });
  return c.body(null, 204);
});

import {
  acceptInviteBodySchema,
  createInviteBodySchema,
  type InviteDto,
  inviteTokenBodySchema,
  type LoginResponse,
} from "@anchor/shared";
import { Hono } from "hono";
import { recordAudit } from "../audit/record";
import { requireUser } from "../auth/middleware";
import { createSession, setSessionCookie } from "../auth/sessions";
import { authorize } from "../authz/policy";
import { hashPassword } from "../crypto/password";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/errors";
import { parseJson } from "../lib/validate";
import { findUserByEmail, findUserById, toUserDto } from "../users/repo";
import {
  acceptInvite,
  createInvite,
  findValidInvite,
  getInvite,
  listInvites,
  revokeInvite,
  toInviteDto,
} from "./repo";

/** Mounted at /api/v1/invites. inspect/accept are public; the rest need invite:manage. */
export const inviteRoutes = new Hono<AppEnv>();

/** One message for every unusable token, so responses never reveal why a link failed. */
const invalidLink = () => new ApiError(404, "not_found", "Link is invalid or has expired");

inviteRoutes.post("/inspect", async (c) => {
  const { token } = await parseJson(c, inviteTokenBodySchema);
  const invite = await findValidInvite(c.env.DB, token, Date.now());
  if (!invite) throw invalidLink();
  return c.json<{ email: string; role: InviteDto["role"] }>({
    email: invite.email,
    role: invite.role,
  });
});

inviteRoutes.post("/accept", async (c) => {
  const body = await parseJson(c, acceptInviteBodySchema);
  const now = Date.now();
  const invite = await findValidInvite(c.env.DB, body.token, now);
  if (!invite) throw invalidLink();
  const passwordHash = await hashPassword(body.password);
  const userId = await acceptInvite(c.env.DB, body.token, { name: body.name, passwordHash }, now);
  if (!userId) throw invalidLink();
  const user = await findUserById(c.env.DB, userId);
  if (!user) throw invalidLink();
  await recordAudit(c, {
    action: "invite.accepted",
    actor: { type: "user", id: user.id, label: user.email },
    target: invite.id,
    metadata: { email: user.email, role: user.role },
  });
  const { token, expiresAt } = await createSession(
    c.env.DB,
    user.id,
    "web",
    c.req.header("user-agent") ?? null,
    now,
  );
  setSessionCookie(c, token, expiresAt);
  return c.json<LoginResponse>({ user: toUserDto(user), expiresAt });
});

inviteRoutes.get("/", async (c) => {
  await authorize(c.env.DB, requireUser(c), "invite:manage");
  const invites = await listInvites(c.env.DB);
  return c.json<{ invites: InviteDto[] }>({ invites: invites.map(toInviteDto) });
});

inviteRoutes.post("/", async (c) => {
  const actor = requireUser(c);
  await authorize(c.env.DB, actor, "invite:manage");
  const body = await parseJson(c, createInviteBodySchema);
  if (body.role === "owner" && actor.role !== "owner") {
    throw new ApiError(403, "forbidden", "Only an owner can invite an owner");
  }
  if (await findUserByEmail(c.env.DB, body.email)) {
    throw new ApiError(409, "conflict", "User already exists");
  }
  const { row, token } = await createInvite(
    c.env.DB,
    { email: body.email, role: body.role, createdBy: actor.userId },
    Date.now(),
  );
  await recordAudit(c, {
    action: "invite.created",
    target: row.id,
    metadata: { email: row.email, role: row.role },
  });
  const url = `${new URL(c.req.url).origin}/accept-invite#token=${token}`;
  return c.json<{ invite: InviteDto; url: string }>({ invite: toInviteDto(row), url }, 201);
});

inviteRoutes.delete("/:id", async (c) => {
  await authorize(c.env.DB, requireUser(c), "invite:manage");
  const id = c.req.param("id");
  if (await revokeInvite(c.env.DB, id, Date.now())) {
    await recordAudit(c, { action: "invite.revoked", target: id });
  } else if (!(await getInvite(c.env.DB, id))) {
    throw new ApiError(404, "not_found", "Invite not found");
  }
  return c.body(null, 204);
});

import { addMemberBodySchema, type MemberDto, updateMemberBodySchema } from "@anchor/shared";
import { type Context, Hono } from "hono";
import { recordAudit } from "../audit/record";
import { requireUser } from "../auth/middleware";
import { authorize } from "../authz/policy";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/errors";
import { parseJson } from "../lib/validate";
import { getEnvironmentBySlug, getProjectBySlug } from "../projects/repo";
import { findUserByEmail } from "../users/repo";
import { addMember, getMember, listMembers, removeMember, updateMember } from "./repo";

/** Mounted at /api/v1/projects/:project/members. User sessions with member:manage only. */
export const memberRoutes = new Hono<AppEnv>();

async function managedProject(c: Context<AppEnv>) {
  const principal = requireUser(c);
  const project = await getProjectBySlug(c.env.DB, c.req.param("project") ?? "");
  await authorize(c.env.DB, principal, "member:manage", { projectId: project.id });
  return project;
}

async function resolveEnvironmentIds(
  db: D1Database,
  projectId: string,
  slugs: string[] | null,
): Promise<string[] | null> {
  if (slugs === null) return null;
  const ids: string[] = [];
  for (const slug of slugs) ids.push((await getEnvironmentBySlug(db, projectId, slug)).id);
  return ids;
}

const memberNotFound = () => new ApiError(404, "not_found", "Member not found");
const auditMetadata = (m: MemberDto) => ({
  userId: m.userId,
  role: m.role,
  environments: m.environments,
});

memberRoutes.get("/", async (c) => {
  const project = await managedProject(c);
  return c.json<{ members: MemberDto[] }>({ members: await listMembers(c.env.DB, project.id) });
});

memberRoutes.post("/", async (c) => {
  const project = await managedProject(c);
  const body = await parseJson(c, addMemberBodySchema);
  const user = await findUserByEmail(c.env.DB, body.email);
  if (!user) throw new ApiError(404, "not_found", "User not found");
  if (user.disabled_at !== null) throw new ApiError(409, "conflict", "User is disabled");
  const environmentIds = await resolveEnvironmentIds(c.env.DB, project.id, body.environments);
  await addMember(
    c.env.DB,
    { projectId: project.id, userId: user.id, role: body.role, environmentIds },
    Date.now(),
  );
  const member = await getMember(c.env.DB, project.id, user.id);
  if (!member) throw memberNotFound();
  await recordAudit(c, {
    action: "member.added",
    projectId: project.id,
    target: user.id,
    metadata: auditMetadata(member),
  });
  return c.json<{ member: MemberDto }>({ member }, 201);
});

memberRoutes.patch("/:userId", async (c) => {
  const project = await managedProject(c);
  const userId = c.req.param("userId");
  const body = await parseJson(c, updateMemberBodySchema);
  const environmentIds =
    body.environments === undefined
      ? undefined
      : await resolveEnvironmentIds(c.env.DB, project.id, body.environments);
  const outcome = await updateMember(
    c.env.DB,
    project.id,
    userId,
    { role: body.role, environmentIds },
    Date.now(),
  );
  if (outcome === "not_found") throw memberNotFound();
  if (outcome === "admin_restricted") {
    throw new ApiError(400, "bad_request", "A project admin cannot be restricted to environments");
  }
  const member = await getMember(c.env.DB, project.id, userId);
  if (!member) throw memberNotFound();
  await recordAudit(c, {
    action: "member.updated",
    projectId: project.id,
    target: userId,
    metadata: auditMetadata(member),
  });
  return c.json<{ member: MemberDto }>({ member });
});

memberRoutes.delete("/:userId", async (c) => {
  const project = await managedProject(c);
  const userId = c.req.param("userId");
  const member = await getMember(c.env.DB, project.id, userId);
  if (!member || !(await removeMember(c.env.DB, project.id, userId))) throw memberNotFound();
  await recordAudit(c, {
    action: "member.removed",
    projectId: project.id,
    target: userId,
    metadata: auditMetadata(member),
  });
  return c.body(null, 204);
});

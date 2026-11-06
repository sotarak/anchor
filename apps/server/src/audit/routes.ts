import { type AuditEventDto, auditQuerySchema } from "@anchor/shared";
import { Hono } from "hono";
import { requireUser } from "../auth/middleware";
import { authorize } from "../authz/policy";
import type { AppEnv } from "../env";
import { parseQuery } from "../lib/validate";
import { getProjectBySlug } from "../projects/repo";
import { queryAudit } from "./repo";

type AuditPage = { events: AuditEventDto[]; nextCursor: string | null };

/** Mounted at /api/v1/audit: instance-wide, owners and admins only. */
export const instanceAuditRoutes = new Hono<AppEnv>();

instanceAuditRoutes.get("/", async (c) => {
  await authorize(c.env.DB, requireUser(c), "audit:read");
  const query = parseQuery(c, auditQuerySchema);
  return c.json<AuditPage>(await queryAudit(c.env.DB, query));
});

/** Mounted at /api/v1/projects/:project/audit: one project, its admins included. */
export const projectAuditRoutes = new Hono<AppEnv>();

projectAuditRoutes.get("/", async (c) => {
  const principal = requireUser(c);
  const project = await getProjectBySlug(c.env.DB, c.req.param("project") ?? "");
  await authorize(c.env.DB, principal, "audit:read", { projectId: project.id });
  const query = parseQuery(c, auditQuerySchema);
  // The route's project always wins: a projectId query parameter can never widen the scope.
  return c.json<AuditPage>(await queryAudit(c.env.DB, { ...query, projectId: project.id }));
});

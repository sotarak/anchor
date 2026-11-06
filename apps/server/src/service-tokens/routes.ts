import { createServiceTokenBodySchema, type ServiceTokenDto } from "@anchor/shared";
import { Hono } from "hono";
import { recordAudit } from "../audit/record";
import { requireUser } from "../auth/middleware";
import { authorize } from "../authz/policy";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/errors";
import { parseJson } from "../lib/validate";
import { getEnvironmentBySlug, getProjectBySlug, listEnvironments } from "../projects/repo";
import {
  createServiceToken,
  listServiceTokens,
  revokeServiceToken,
  toServiceTokenDto,
} from "./repo";

const DAY_MS = 86_400_000;

/** Mounted at /api/v1/projects/:project/service-tokens. User sessions only. */
export const serviceTokenRoutes = new Hono<AppEnv>();

serviceTokenRoutes.get("/", async (c) => {
  const principal = requireUser(c);
  const project = await getProjectBySlug(c.env.DB, c.req.param("project") ?? "");
  await authorize(c.env.DB, principal, "service_token:manage", { projectId: project.id });
  const [rows, envs] = await Promise.all([
    listServiceTokens(c.env.DB, project.id),
    listEnvironments(c.env.DB, project.id),
  ]);
  const envSlugById = new Map(envs.map((e) => [e.id, e.slug]));
  return c.json<{ serviceTokens: ServiceTokenDto[] }>({
    serviceTokens: rows.map((r) => toServiceTokenDto(r, project.slug, envSlugById)),
  });
});

serviceTokenRoutes.post("/", async (c) => {
  const principal = requireUser(c);
  const project = await getProjectBySlug(c.env.DB, c.req.param("project") ?? "");
  await authorize(c.env.DB, principal, "service_token:manage", { projectId: project.id });
  const body = await parseJson(c, createServiceTokenBodySchema);
  const envSlugById = new Map<string, string>();
  const scopes = [];
  for (const scope of body.scopes) {
    const environment = await getEnvironmentBySlug(c.env.DB, project.id, scope.environment);
    envSlugById.set(environment.id, environment.slug);
    scopes.push({ environmentId: environment.id, path: scope.path });
  }
  const now = Date.now();
  const { row, token } = await createServiceToken(
    c.env.DB,
    {
      projectId: project.id,
      name: body.name,
      permission: body.permission,
      scopes,
      expiresAt: now + body.expiresInDays * DAY_MS,
      createdBy: principal.userId,
    },
    now,
  );
  const serviceToken = toServiceTokenDto(row, project.slug, envSlugById);
  await recordAudit(c, {
    action: "service_token.created",
    projectId: project.id,
    target: row.id,
    metadata: { name: body.name, permission: body.permission, scopes: serviceToken.scopes },
  });
  return c.json<{ serviceToken: ServiceTokenDto; token: string }>({ serviceToken, token }, 201);
});

serviceTokenRoutes.delete("/:id", async (c) => {
  const principal = requireUser(c);
  const project = await getProjectBySlug(c.env.DB, c.req.param("project") ?? "");
  await authorize(c.env.DB, principal, "service_token:manage", { projectId: project.id });
  const id = c.req.param("id");
  const outcome = await revokeServiceToken(c.env.DB, project.id, id, Date.now());
  if (outcome === "not_found") throw new ApiError(404, "not_found", "Service token not found");
  if (outcome === "revoked") {
    await recordAudit(c, { action: "service_token.revoked", projectId: project.id, target: id });
  }
  return c.body(null, 204);
});

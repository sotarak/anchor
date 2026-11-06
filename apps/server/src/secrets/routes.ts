import {
  putSecretBodySchema,
  type SecretDto,
  secretKeySchema,
  secretQuerySchema,
} from "@anchor/shared";
import { type Context, Hono } from "hono";
import { capKeys, recordAudit } from "../audit/record";
import { requirePrincipal } from "../auth/middleware";
import { type Action, authorize } from "../authz/policy";
import { getRootKey } from "../crypto/keyring";
import type { AppEnv, Principal } from "../env";
import { ApiError } from "../lib/errors";
import { parseJson, parseQuery } from "../lib/validate";
import {
  type EnvironmentRow,
  getEnvironmentBySlug,
  getProjectBySlug,
  type ProjectRow,
} from "../projects/repo";
import { deleteSecret, getSecret, listSecrets, putSecret, type SecretContext } from "./service";

/** Mounted at /api/v1/projects/:project/environments/:env/secrets. */
export const secretRoutes = new Hono<AppEnv>();

function keyParam(c: Context<AppEnv>): string {
  const parsed = secretKeySchema.safeParse(c.req.param("key"));
  if (!parsed.success)
    throw new ApiError(400, "bad_request", "invalid fields: key (invalid_format)");
  return parsed.data;
}

type Target = { principal: Principal; project: ProjectRow; environment: EnvironmentRow };

/** requirePrincipal -> project -> environment. Authorization needs the path, so it comes later. */
async function resolveTarget(c: Context<AppEnv>): Promise<Target> {
  const principal = requirePrincipal(c);
  const project = await getProjectBySlug(c.env.DB, c.req.param("project") ?? "");
  const environment = await getEnvironmentBySlug(c.env.DB, project.id, c.req.param("env") ?? "");
  return { principal, project, environment };
}

/** authorize(action on env + path) -> root key -> service context. */
async function secretContext(
  c: Context<AppEnv>,
  { principal, project, environment }: Target,
  action: Action,
  path: string,
): Promise<SecretContext> {
  await authorize(c.env.DB, principal, action, {
    projectId: project.id,
    environmentId: environment.id,
    path,
  });
  const rootKey = await getRootKey(c.env);
  return {
    db: c.env.DB,
    rootKey,
    project,
    environment,
    // secret_versions.created_by references users; token writes are attributed in the audit log.
    actorId: principal.type === "user" ? principal.userId : null,
    now: Date.now(),
  };
}

secretRoutes.get("/", async (c) => {
  const target = await resolveTarget(c);
  const query = parseQuery(c, secretQuerySchema);
  const ctx = await secretContext(c, target, "secret:read", query.path);
  const secrets = await listSecrets(ctx, query);
  // Values are about to leave: the read must be on record first (fails closed with a 500).
  if (query.reveal) {
    await recordAudit(c, {
      action: "secret.read",
      projectId: target.project.id,
      environmentId: target.environment.id,
      metadata: { path: query.path, ...capKeys(secrets.map((s) => s.key)) },
    });
  }
  return c.json<{ secrets: SecretDto[] }>({ secrets });
});

secretRoutes.get("/:key", async (c) => {
  const target = await resolveTarget(c);
  const key = keyParam(c);
  const { path } = parseQuery(c, secretQuerySchema);
  const ctx = await secretContext(c, target, "secret:read", path);
  const secret = await getSecret(ctx, { path, key });
  await recordAudit(c, {
    action: "secret.read",
    projectId: target.project.id,
    environmentId: target.environment.id,
    target: key,
    metadata: { path, ...capKeys([key]) },
  });
  return c.json<{ secret: SecretDto }>({ secret });
});

secretRoutes.put("/:key", async (c) => {
  const target = await resolveTarget(c);
  const key = keyParam(c);
  const body = await parseJson(c, putSecretBodySchema);
  const ctx = await secretContext(c, target, "secret:write", body.path);
  const { secret, created, changed } = await putSecret(ctx, { key, ...body });
  if (changed) {
    await recordAudit(c, {
      action: created ? "secret.created" : "secret.updated",
      projectId: target.project.id,
      environmentId: target.environment.id,
      target: key,
      metadata: { path: body.path, key, version: secret.version },
    });
  }
  // The service never sets value on a put result; strip defensively so a write never echoes it.
  const { value: _omit, ...withoutValue } = secret;
  return c.json<{ secret: SecretDto }>({ secret: withoutValue }, created ? 201 : 200);
});

secretRoutes.delete("/:key", async (c) => {
  const target = await resolveTarget(c);
  const key = keyParam(c);
  const { path } = parseQuery(c, secretQuerySchema);
  const ctx = await secretContext(c, target, "secret:write", path);
  await deleteSecret(ctx, { path, key });
  await recordAudit(c, {
    action: "secret.deleted",
    projectId: target.project.id,
    environmentId: target.environment.id,
    target: key,
    metadata: { path, key },
  });
  return c.body(null, 204);
});

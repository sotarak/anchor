import {
  putSecretBodySchema,
  rollbackBodySchema,
  type SecretDto,
  type SecretVersionDto,
  secretKeySchema,
  secretQuerySchema,
  secretVersionParamSchema,
} from "@anchor/shared";
import { type Context, Hono } from "hono";
import { capKeys, readSources, recordAudit } from "../audit/record";
import { requirePrincipal } from "../auth/middleware";
import { type Action, authorize } from "../authz/policy";
import { getRootKeyring } from "../crypto/keyring";
import type { AppEnv, Principal } from "../env";
import { ApiError } from "../lib/errors";
import { parseJson, parseQuery } from "../lib/validate";
import {
  type EnvironmentRow,
  getEnvironmentBySlug,
  getProjectBySlug,
  type ProjectRow,
} from "../projects/repo";
import { deleteSecret, putSecret, type SecretContext } from "./service";
import { getVersionValue, listVersions, rollbackSecret } from "./versions";
import { composeSecret, composeSecrets } from "./view";

/** Mounted at /api/v1/projects/:project/environments/:env/secrets. */
export const secretRoutes = new Hono<AppEnv>();

function keyParam(c: Context<AppEnv>): string {
  const parsed = secretKeySchema.safeParse(c.req.param("key"));
  if (!parsed.success)
    throw new ApiError(400, "bad_request", "invalid fields: key (invalid_format)");
  return parsed.data;
}

export type Target = { principal: Principal; project: ProjectRow; environment: EnvironmentRow };

/** requirePrincipal -> project -> environment. Authorization needs the path, so it comes later. */
export async function resolveTarget(c: Context<AppEnv>): Promise<Target> {
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
  const keyring = await getRootKeyring(c.env);
  return {
    db: c.env.DB,
    keyring,
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
  const { secrets, referenced, imports } = await composeSecrets(
    { ...ctx, principal: target.principal },
    query,
  );
  // Values are about to leave: the read must be on record first (fails closed with a 500).
  if (query.reveal) {
    await recordAudit(c, {
      action: "secret.read",
      projectId: target.project.id,
      environmentId: target.environment.id,
      metadata: {
        path: query.path,
        ...capKeys(secrets.map((s) => s.key)),
        ...readSources(referenced, imports),
      },
    });
  }
  return c.json<{ secrets: SecretDto[] }>({ secrets });
});

function versionParam(c: Context<AppEnv>): number {
  const parsed = secretVersionParamSchema.safeParse(c.req.param("version"));
  if (!parsed.success)
    throw new ApiError(400, "bad_request", "invalid fields: version (invalid_format)");
  return parsed.data;
}

secretRoutes.get("/:key/versions", async (c) => {
  const target = await resolveTarget(c);
  const key = keyParam(c);
  const { path } = parseQuery(c, secretQuerySchema);
  const ctx = await secretContext(c, target, "secret:read", path);
  const versions = await listVersions(ctx, { path, key });
  return c.json<{ versions: SecretVersionDto[] }>({ versions });
});

secretRoutes.get("/:key/versions/:version", async (c) => {
  const target = await resolveTarget(c);
  const key = keyParam(c);
  const versionNumber = versionParam(c);
  const { path } = parseQuery(c, secretQuerySchema);
  const ctx = await secretContext(c, target, "secret:read", path);
  const version = await getVersionValue(ctx, { path, key, version: versionNumber });
  await recordAudit(c, {
    action: "secret.version_read",
    projectId: target.project.id,
    environmentId: target.environment.id,
    target: key,
    metadata: { path, key, version: versionNumber },
  });
  return c.json<{ version: SecretVersionDto & { value: string } }>({ version });
});

secretRoutes.post("/:key/rollback", async (c) => {
  const target = await resolveTarget(c);
  const key = keyParam(c);
  const body = await parseJson(c, rollbackBodySchema);
  const ctx = await secretContext(c, target, "secret:write", body.path);
  const { secret, changed, fromVersion } = await rollbackSecret(ctx, { key, ...body });
  if (changed) {
    await recordAudit(c, {
      action: "secret.rolled_back",
      projectId: target.project.id,
      environmentId: target.environment.id,
      target: key,
      metadata: {
        path: body.path,
        key,
        fromVersion,
        toVersion: body.version,
        newVersion: secret.version,
      },
    });
  }
  const { value: _omit, ...withoutValue } = secret;
  return c.json<{ secret: SecretDto; changed: boolean }>({ secret: withoutValue, changed });
});

secretRoutes.get("/:key", async (c) => {
  const target = await resolveTarget(c);
  const key = keyParam(c);
  const query = parseQuery(c, secretQuerySchema);
  const ctx = await secretContext(c, target, "secret:read", query.path);
  const { secret, referenced, imports } = await composeSecret(
    { ...ctx, principal: target.principal },
    { ...query, key },
  );
  await recordAudit(c, {
    action: "secret.read",
    projectId: target.project.id,
    environmentId: target.environment.id,
    target: key,
    metadata: { path: query.path, ...capKeys([key]), ...readSources(referenced, imports) },
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

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
import type { z } from "zod";
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
import { etagFor, etagMatches } from "./etag";
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
export async function resolveTargetBySlugs(
  c: Context<AppEnv>,
  projectSlug: string,
  envSlug: string,
): Promise<Target> {
  const principal = requirePrincipal(c);
  const project = await getProjectBySlug(c.env.DB, projectSlug);
  const environment = await getEnvironmentBySlug(c.env.DB, project.id, envSlug);
  return { principal, project, environment };
}

/** resolveTargetBySlugs with the :project and :env route parameters. */
export function resolveTarget(c: Context<AppEnv>): Promise<Target> {
  return resolveTargetBySlugs(c, c.req.param("project") ?? "", c.req.param("env") ?? "");
}

/** authorize(action on env + path) -> root key -> service context. */
export async function secretContext(
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
  // The tag covers the exact body, so anything that changes the answer changes the tag. A
  // match sends no values, so it is not a read and writes no audit row.
  const body = JSON.stringify({ secrets } satisfies { secrets: SecretDto[] });
  const etag = await etagFor(c.env, body);
  if (etagMatches(c.req.header("if-none-match"), etag)) {
    return c.body(null, 304, { ETag: etag });
  }
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
  return c.body(body, 200, { ETag: etag, "Content-Type": "application/json" });
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

/**
 * One secret with its value, audited as secret.read before it is returned (fails closed). Shared
 * by GET /:key and the MCP reveal path, so both authorize and audit the same way.
 */
export async function readSecret(
  c: Context<AppEnv>,
  target: Target,
  query: { path: string; key: string; expand: boolean; includeImports: boolean },
): Promise<SecretDto> {
  const ctx = await secretContext(c, target, "secret:read", query.path);
  const { secret, referenced, imports } = await composeSecret(
    { ...ctx, principal: target.principal },
    query,
  );
  await recordAudit(c, {
    action: "secret.read",
    projectId: target.project.id,
    environmentId: target.environment.id,
    target: query.key,
    metadata: { path: query.path, ...capKeys([query.key]), ...readSources(referenced, imports) },
  });
  return secret;
}

type PutSecretBody = z.output<typeof putSecretBodySchema>;

/** Creates or updates a secret and audits a change. The result never carries the value. */
export async function writeSecret(
  c: Context<AppEnv>,
  target: Target,
  key: string,
  body: PutSecretBody,
): Promise<{ secret: SecretDto; created: boolean; changed: boolean }> {
  const ctx = await secretContext(c, target, "secret:write", body.path);
  const { secret, created, changed } = await putSecret(ctx, { key, ...body });
  if (changed) {
    await recordAudit(c, {
      action: created ? "secret.created" : "secret.updated",
      projectId: target.project.id,
      environmentId: target.environment.id,
      target: key,
      metadata: {
        path: body.path,
        key,
        version: secret.version,
        type: secret.type,
        sensitive: secret.sensitive,
      },
    });
  }
  // The service never sets value on a put result; strip defensively so a write never echoes it.
  const { value: _omit, ...withoutValue } = secret;
  return { secret: withoutValue, created, changed };
}

/** Deletes a secret and audits it. */
export async function removeSecret(
  c: Context<AppEnv>,
  target: Target,
  key: string,
  path: string,
): Promise<void> {
  const ctx = await secretContext(c, target, "secret:write", path);
  await deleteSecret(ctx, { path, key });
  await recordAudit(c, {
    action: "secret.deleted",
    projectId: target.project.id,
    environmentId: target.environment.id,
    target: key,
    metadata: { path, key },
  });
}

secretRoutes.get("/:key", async (c) => {
  const target = await resolveTarget(c);
  const key = keyParam(c);
  const query = parseQuery(c, secretQuerySchema);
  const secret = await readSecret(c, target, { ...query, key });
  return c.json<{ secret: SecretDto }>({ secret });
});

secretRoutes.put("/:key", async (c) => {
  const target = await resolveTarget(c);
  const key = keyParam(c);
  const body = await parseJson(c, putSecretBodySchema);
  const { secret, created } = await writeSecret(c, target, key, body);
  return c.json<{ secret: SecretDto }>({ secret }, created ? 201 : 200);
});

secretRoutes.delete("/:key", async (c) => {
  const target = await resolveTarget(c);
  const key = keyParam(c);
  const { path } = parseQuery(c, secretQuerySchema);
  await removeSecret(c, target, key, path);
  return c.body(null, 204);
});

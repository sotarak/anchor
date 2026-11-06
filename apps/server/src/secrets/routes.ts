import {
  putSecretBodySchema,
  type SecretDto,
  secretKeySchema,
  secretQuerySchema,
} from "@anchor/shared";
import { type Context, Hono } from "hono";
import { requireUser } from "../auth/middleware";
import { type Action, authorize } from "../authz/policy";
import { getRootKey } from "../crypto/keyring";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/errors";
import { parseJson, parseQuery } from "../lib/validate";
import { getEnvironmentBySlug, getProjectBySlug } from "../projects/repo";
import { deleteSecret, getSecret, listSecrets, putSecret, type SecretContext } from "./service";

/** Mounted at /api/v1/projects/:project/environments/:env/secrets. */
export const secretRoutes = new Hono<AppEnv>();

function keyParam(c: Context<AppEnv>): string {
  const parsed = secretKeySchema.safeParse(c.req.param("key"));
  if (!parsed.success)
    throw new ApiError(400, "bad_request", "invalid fields: key (invalid_format)");
  return parsed.data;
}

/** requireUser -> project -> authorize -> environment -> root key. */
async function secretContext(c: Context<AppEnv>, action: Action): Promise<SecretContext> {
  const principal = requireUser(c);
  const project = await getProjectBySlug(c.env.DB, c.req.param("project") ?? "");
  authorize(principal, action, { projectId: project.id });
  const environment = await getEnvironmentBySlug(c.env.DB, project.id, c.req.param("env") ?? "");
  const rootKey = await getRootKey(c.env);
  return {
    db: c.env.DB,
    rootKey,
    project,
    environment,
    actorId: principal.userId,
    now: Date.now(),
  };
}

secretRoutes.get("/", async (c) => {
  const ctx = await secretContext(c, "secret:read");
  const query = parseQuery(c, secretQuerySchema);
  const secrets = await listSecrets(ctx, query);
  return c.json<{ secrets: SecretDto[] }>({ secrets });
});

secretRoutes.get("/:key", async (c) => {
  const ctx = await secretContext(c, "secret:read");
  const key = keyParam(c);
  const { path } = parseQuery(c, secretQuerySchema);
  const secret = await getSecret(ctx, { path, key });
  return c.json<{ secret: SecretDto }>({ secret });
});

secretRoutes.put("/:key", async (c) => {
  const ctx = await secretContext(c, "secret:write");
  const key = keyParam(c);
  const body = await parseJson(c, putSecretBodySchema);
  const { secret, created } = await putSecret(ctx, { key, ...body });
  // The service never sets value on a put result; strip defensively so a write never echoes it.
  const { value: _omit, ...withoutValue } = secret;
  return c.json<{ secret: SecretDto }>({ secret: withoutValue }, created ? 201 : 200);
});

secretRoutes.delete("/:key", async (c) => {
  const ctx = await secretContext(c, "secret:write");
  const key = keyParam(c);
  const { path } = parseQuery(c, secretQuerySchema);
  await deleteSecret(ctx, { path, key });
  return c.body(null, 204);
});

import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../env";
import { requestContext } from "../lib/request";
import { verifyPkceS256 } from "./pkce";
import { isValidRedirectUri } from "./redirects";
import { OAUTH_SCOPES } from "./scopes";
import {
  countPendingClients,
  findGrantIdByToken,
  getGrantScopes,
  issueTokenPair,
  redeemCode,
  registerClient,
  revokeGrant,
  rotateRefresh,
} from "./store";

/**
 * The anonymous OAuth endpoints (spec 2026-11-07-v0.4.0-mcp-oauth): metadata, dynamic client
 * registration, token and revocation. Mounted at the origin root, before static assets
 * (`run_worker_first`). None of them reads cookies, so they answer CORS for any origin.
 */
export const MAX_PENDING_CLIENTS = 500;
export const MAX_PENDING_CLIENTS_PER_IP = 10;
const MAX_REDIRECT_URIS = 10;
const MAX_CLIENT_NAME = 100;
const DEFAULT_CLIENT_NAME = "MCP client";

export const PUBLIC_OAUTH_PATHS = [
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
  "/oauth/register",
  "/oauth/token",
  "/oauth/revoke",
] as const;

export const mcpResource = (c: Context) => `${new URL(c.req.url).origin}/mcp`;

type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client_metadata"
  | "invalid_grant"
  | "invalid_target"
  | "unsupported_grant_type";

function oauthError(
  c: Context,
  error: OAuthErrorCode,
  description: string,
  status: ContentfulStatusCode = 400,
) {
  c.header("Cache-Control", "no-store");
  return c.json({ error, error_description: description }, status);
}

export const publicOAuthRoutes = new Hono<AppEnv>();

for (const path of PUBLIC_OAUTH_PATHS) {
  publicOAuthRoutes.use(
    path,
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["authorization", "content-type", "mcp-protocol-version"],
      maxAge: 86_400,
    }),
  );
  publicOAuthRoutes.use(path, requestContext);
}

const protectedResource = (c: Context) =>
  c.json({
    resource: mcpResource(c),
    authorization_servers: [new URL(c.req.url).origin],
    scopes_supported: OAUTH_SCOPES,
    bearer_methods_supported: ["header"],
  });

publicOAuthRoutes.get("/.well-known/oauth-protected-resource", protectedResource);
publicOAuthRoutes.get("/.well-known/oauth-protected-resource/mcp", protectedResource);

publicOAuthRoutes.get("/.well-known/oauth-authorization-server", (c) => {
  const origin = new URL(c.req.url).origin;
  return c.json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: OAUTH_SCOPES,
  });
});

/** RFC 7591 dynamic registration, public clients only. */
publicOAuthRoutes.post("/oauth/register", async (c) => {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await c.req.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return oauthError(c, "invalid_client_metadata", "The body must be a JSON object");
  }
  const uris = body.redirect_uris;
  if (
    !Array.isArray(uris) ||
    uris.length < 1 ||
    uris.length > MAX_REDIRECT_URIS ||
    !uris.every((u) => typeof u === "string" && isValidRedirectUri(u))
  ) {
    return oauthError(
      c,
      "invalid_client_metadata",
      "redirect_uris must list 1 to 10 https URLs or http loopback URLs, without fragments",
    );
  }
  const name = body.client_name ?? DEFAULT_CLIENT_NAME;
  if (typeof name !== "string" || name.trim() === "" || name.length > MAX_CLIENT_NAME) {
    return oauthError(c, "invalid_client_metadata", "client_name must be 1 to 100 characters");
  }
  const authMethod = body.token_endpoint_auth_method;
  if (authMethod !== undefined && authMethod !== "none") {
    return oauthError(c, "invalid_client_metadata", "Only public clients are supported");
  }
  const ip = c.get("clientIp");
  const now = Date.now();
  const pending = await countPendingClients(c.env.DB, ip, now);
  if (
    pending.total >= MAX_PENDING_CLIENTS ||
    (ip !== null && pending.fromIp >= MAX_PENDING_CLIENTS_PER_IP)
  ) {
    return oauthError(
      c,
      "invalid_request",
      "Too many pending client registrations, try again later",
      429,
    );
  }
  const client = await registerClient(c.env.DB, {
    name: name.trim(),
    redirectUris: uris as string[],
    ip,
    now,
  });
  return c.json(
    {
      client_id: client.id,
      client_id_issued_at: Math.floor(now / 1000),
      client_name: client.name,
      redirect_uris: client.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    201,
  );
});

async function formParams(c: Context): Promise<URLSearchParams | null> {
  const type = c.req.header("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/x-www-form-urlencoded")) return null;
  return new URLSearchParams(await c.req.text());
}

async function tokenResponse(c: Context, grantId: string, scopes: string, now: number) {
  const pair = await issueTokenPair(c.env.DB, grantId, now);
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
  return c.json({
    access_token: pair.accessToken,
    token_type: "Bearer",
    expires_in: pair.expiresIn,
    refresh_token: pair.refreshToken,
    scope: scopes,
  });
}

publicOAuthRoutes.post("/oauth/token", async (c) => {
  const p = await formParams(c);
  if (!p) return oauthError(c, "invalid_request", "Use application/x-www-form-urlencoded");
  const resource = p.get("resource");
  if (resource !== null && resource !== mcpResource(c)) {
    return oauthError(c, "invalid_target", "Unknown resource");
  }
  const now = Date.now();
  const grantType = p.get("grant_type");

  if (grantType === "authorization_code") {
    const code = p.get("code");
    const redirectUri = p.get("redirect_uri");
    const clientId = p.get("client_id");
    const verifier = p.get("code_verifier");
    if (!code || !redirectUri || !clientId || !verifier) {
      return oauthError(
        c,
        "invalid_request",
        "code, redirect_uri, client_id and code_verifier are required",
      );
    }
    const row = await redeemCode(c.env.DB, { code, now });
    const invalid = () => oauthError(c, "invalid_grant", "The authorization code is invalid");
    if (row === null || row === "reused") return invalid();
    if (row.client_id !== clientId || row.redirect_uri !== redirectUri) return invalid();
    if (!(await verifyPkceS256(verifier, row.code_challenge))) return invalid();
    if (row.grant_revoked_at !== null || row.user_disabled_at !== null) return invalid();
    return tokenResponse(c, row.grant_id, row.scopes, now);
  }

  if (grantType === "refresh_token") {
    const refreshToken = p.get("refresh_token");
    const clientId = p.get("client_id");
    if (!refreshToken || !clientId) {
      return oauthError(c, "invalid_request", "refresh_token and client_id are required");
    }
    const rotated = await rotateRefresh(c.env.DB, { refreshToken, clientId, now });
    if (rotated === null || rotated === "reused") {
      return oauthError(c, "invalid_grant", "The refresh token is invalid");
    }
    const scopes = await getGrantScopes(c.env.DB, rotated.grantId);
    return tokenResponse(c, rotated.grantId, scopes ?? "", now);
  }

  return oauthError(c, "unsupported_grant_type", "Use authorization_code or refresh_token");
});

/** RFC 7009: revokes the token's whole grant. Always 200, so it reveals nothing. */
publicOAuthRoutes.post("/oauth/revoke", async (c) => {
  const p = await formParams(c);
  const token = p?.get("token");
  if (token) {
    const grantId = await findGrantIdByToken(c.env.DB, token);
    if (grantId) await revokeGrant(c.env.DB, grantId, Date.now());
  }
  c.header("Cache-Control", "no-store");
  return c.body(null, 200);
});

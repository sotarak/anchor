import {
  type OAuthAuthorizeCheckDto,
  type OAuthAuthorizeRequest,
  type OAuthGrantDto,
  oauthAuthorizeRequestSchema,
  oauthDecisionBodySchema,
} from "@anchor/shared";
import { type Context, Hono } from "hono";
import { recordAudit } from "../audit/record";
import { requireUser, requireWebUser } from "../auth/middleware";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/errors";
import { parseJson } from "../lib/validate";
import { mcpResource } from "./public-routes";
import { isAllowedRedirect } from "./redirects";
import { type OAuthScope, parseScopes, splitScopes } from "./scopes";
import { createGrant, getClient, issueCode, type OAuthClientRow, revokeGrant } from "./store";

/**
 * The dashboard side of /oauth/authorize (spec 2026-11-07-v0.4.0-mcp-oauth), mounted at
 * /api/v1/oauth. Check and decision need a dashboard session (cookie + web session), like CLI
 * login approval, so a stolen CLI token cannot approve agents.
 */
export const consentRoutes = new Hono<AppEnv>();

const WEB_ONLY = "Approve apps from the dashboard";

type Checked =
  | { kind: "ok"; client: OAuthClientRow; scopes: OAuthScope[] }
  | { kind: "redirect"; redirectTo: string };

/** `redirect_uri` with OAuth response parameters; `state` is echoed only when sent. */
function withParams(redirectUri: string, params: Record<string, string>, state?: string): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (state !== undefined) url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Validates an authorization request. An unknown client or a redirect URI it did not register is
 * a 400 the page shows: never redirect to an unverified URI (RFC 6749 §4.1.2.1). Every other
 * problem is sent back to the client's redirect URI with `error` and `state`.
 */
async function checkRequest(c: Context<AppEnv>, req: OAuthAuthorizeRequest): Promise<Checked> {
  const client = await getClient(c.env.DB, req.client_id);
  if (!client) {
    throw new ApiError(
      400,
      "bad_request",
      "This app is not registered. Start the connection again from your AI agent.",
    );
  }
  if (!isAllowedRedirect(client.redirect_uris, req.redirect_uri)) {
    throw new ApiError(
      400,
      "bad_request",
      "This app asked to return to an address it did not register.",
    );
  }
  const fail = (error: string): Checked => ({
    kind: "redirect",
    redirectTo: withParams(req.redirect_uri, { error }, req.state),
  });
  if (req.response_type !== "code") return fail("unsupported_response_type");
  if (!req.code_challenge || req.code_challenge_method !== "S256") return fail("invalid_request");
  if (req.resource !== undefined && req.resource !== mcpResource(c)) return fail("invalid_target");
  const scopes = parseScopes(req.scope);
  if (!scopes) return fail("invalid_scope");
  return { kind: "ok", client, scopes };
}

consentRoutes.post("/authorize/check", async (c) => {
  await requireWebUser(c, WEB_ONLY);
  const req = await parseJson(c, oauthAuthorizeRequestSchema);
  const checked = await checkRequest(c, req);
  if (checked.kind === "redirect") return c.json({ redirectTo: checked.redirectTo });
  return c.json<OAuthAuthorizeCheckDto>({
    client: {
      id: checked.client.id,
      name: checked.client.name,
      redirectHost: new URL(req.redirect_uri).host,
    },
    scopes: checked.scopes,
    revealRequested: checked.scopes.includes("secrets:reveal"),
  });
});

consentRoutes.post("/authorize/decision", async (c) => {
  const user = await requireWebUser(c, WEB_ONLY);
  const body = await parseJson(c, oauthDecisionBodySchema);
  const checked = await checkRequest(c, body);
  if (checked.kind === "redirect") return c.json({ redirectTo: checked.redirectTo });
  const { client } = checked;
  const denied = () => withParams(body.redirect_uri, { error: "access_denied" }, body.state);

  // Reveal only when the client asked for it and the person ticked the box.
  const scopes = checked.scopes.filter((s) => s !== "secrets:reveal" || body.allowReveal);
  if (!body.approve || scopes.length === 0) {
    await recordAudit(c, {
      action: "oauth.denied",
      target: client.id,
      metadata: { clientId: client.id, clientName: client.name },
    });
    return c.json({ redirectTo: denied() });
  }
  const now = Date.now();
  const grantId = await createGrant(c.env.DB, {
    userId: user.userId,
    clientId: client.id,
    scopes,
    now,
  });
  const code = await issueCode(c.env.DB, {
    grantId,
    redirectUri: body.redirect_uri,
    codeChallenge: body.code_challenge ?? "",
    now,
  });
  await recordAudit(c, {
    action: "oauth.authorized",
    target: grantId,
    metadata: { clientId: client.id, clientName: client.name, scopes },
  });
  return c.json({ redirectTo: withParams(body.redirect_uri, { code }, body.state) });
});

consentRoutes.get("/grants", async (c) => {
  const user = requireUser(c);
  const { results } = await c.env.DB.prepare(
    `SELECT g.id, g.scopes, g.created_at, g.last_used_at, c.name AS client_name
     FROM oauth_grants g JOIN oauth_clients c ON c.id = g.client_id
     WHERE g.user_id = ? AND g.revoked_at IS NULL
     ORDER BY g.created_at DESC, g.id DESC`,
  )
    .bind(user.userId)
    .all<{
      id: string;
      scopes: string;
      created_at: number;
      last_used_at: number | null;
      client_name: string;
    }>();
  return c.json<{ grants: OAuthGrantDto[] }>({
    grants: results.map((r) => ({
      id: r.id,
      clientName: r.client_name,
      scopes: splitScopes(r.scopes),
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
    })),
  });
});

consentRoutes.delete("/grants/:id", async (c) => {
  const user = requireUser(c);
  const id = c.req.param("id");
  const grant = await c.env.DB.prepare(
    `SELECT g.client_id, c.name AS client_name FROM oauth_grants g
     JOIN oauth_clients c ON c.id = g.client_id
     WHERE g.id = ? AND g.user_id = ? AND g.revoked_at IS NULL`,
  )
    .bind(id, user.userId)
    .first<{ client_id: string; client_name: string }>();
  if (!grant || !(await revokeGrant(c.env.DB, id, Date.now()))) {
    throw new ApiError(404, "not_found", "Connected app not found");
  }
  await recordAudit(c, {
    action: "oauth.revoked",
    target: id,
    metadata: { clientId: grant.client_id, clientName: grant.client_name },
  });
  return c.body(null, 204);
});

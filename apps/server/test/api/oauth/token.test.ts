import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { authenticateAccessToken } from "#src/oauth/store";
import {
  api,
  createUserWithSession,
  formPost,
  json,
  oauthCode,
  REDIRECT,
  resetDb,
  VERIFIER,
} from "#test/support";

type TokenBody = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
};
type ErrorBody = { error: string; error_description?: string };

let userId: string;
beforeEach(async () => {
  await resetDb();
  ({ userId } = await createUserWithSession());
});

const exchange = (c: { code: string; clientId: string }, over: Record<string, string> = {}) =>
  formPost("/oauth/token", {
    grant_type: "authorization_code",
    code: c.code,
    redirect_uri: REDIRECT,
    client_id: c.clientId,
    code_verifier: VERIFIER,
    ...over,
  });

const refresh = (refreshToken: string, clientId: string) =>
  formPost("/oauth/token", {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });

const errorOf = async (res: Response) => {
  expect(res.status).toBe(400);
  return (await json<ErrorBody>(res)).error;
};

const grantRevoked = async (grantId: string) =>
  (
    await env.DB.prepare("SELECT revoked_at FROM oauth_grants WHERE id = ?")
      .bind(grantId)
      .first<{ revoked_at: number | null }>()
  )?.revoked_at !== null;

describe("POST /oauth/token (authorization_code)", () => {
  it("the happy path returns a token pair with no-store and the granted scope", async () => {
    const c = await oauthCode(userId);
    const res = await exchange(c);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = await json<TokenBody>(res);
    expect(body).toMatchObject({
      token_type: "Bearer",
      expires_in: 3600,
      scope: "secrets:read secrets:write",
    });
    expect(body.access_token).toMatch(/^anc_oat_/);
    expect(body.refresh_token).toMatch(/^anc_ort_/);
    expect(await authenticateAccessToken(env.DB, body.access_token, Date.now())).toMatchObject({
      userId,
      grantId: c.grantId,
    });
  });

  it("a resource equal to the MCP endpoint is accepted", async () => {
    const c = await oauthCode(userId);
    expect((await exchange(c, { resource: "http://anchor.test/mcp" })).status).toBe(200);
  });

  it("a wrong verifier → invalid_grant", async () => {
    const c = await oauthCode(userId);
    expect(await errorOf(await exchange(c, { code_verifier: "w".repeat(43) }))).toBe(
      "invalid_grant",
    );
  });

  it("a wrong redirect_uri or client_id → invalid_grant", async () => {
    const a = await oauthCode(userId);
    expect(await errorOf(await exchange(a, { redirect_uri: "http://localhost:1/callback" }))).toBe(
      "invalid_grant",
    );
    const b = await oauthCode(userId);
    expect(await errorOf(await exchange(b, { client_id: a.clientId }))).toBe("invalid_grant");
  });

  it("a reused code → invalid_grant and the grant is revoked", async () => {
    const c = await oauthCode(userId);
    const first = await json<TokenBody>(await exchange(c));
    expect(await errorOf(await exchange(c))).toBe("invalid_grant");
    expect(await grantRevoked(c.grantId)).toBe(true);
    expect(await authenticateAccessToken(env.DB, first.access_token, Date.now())).toBeNull();
  });

  it("a resource other than <origin>/mcp → invalid_target, and the code is not spent", async () => {
    const c = await oauthCode(userId);
    expect(await errorOf(await exchange(c, { resource: "https://evil.example/mcp" }))).toBe(
      "invalid_target",
    );
    expect((await exchange(c)).status).toBe(200);
  });

  it("missing parameters → invalid_request", async () => {
    const c = await oauthCode(userId);
    expect(await errorOf(await exchange(c, { code_verifier: "" }))).toBe("invalid_request");
  });

  it("a disabled user → invalid_grant", async () => {
    const c = await oauthCode(userId);
    await env.DB.prepare("UPDATE users SET disabled_at = ? WHERE id = ?")
      .bind(Date.now(), userId)
      .run();
    expect(await errorOf(await exchange(c))).toBe("invalid_grant");
  });

  it("a code whose grant was revoked → invalid_grant", async () => {
    const c = await oauthCode(userId);
    await env.DB.prepare("UPDATE oauth_grants SET revoked_at = 1 WHERE id = ?")
      .bind(c.grantId)
      .run();
    expect(await errorOf(await exchange(c))).toBe("invalid_grant");
  });

  it("an unknown grant_type → unsupported_grant_type", async () => {
    expect(await errorOf(await formPost("/oauth/token", { grant_type: "password" }))).toBe(
      "unsupported_grant_type",
    );
  });

  it("a JSON body → invalid_request", async () => {
    const res = await api("/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code" }),
    });
    expect(await errorOf(res)).toBe("invalid_request");
  });
});

describe("POST /oauth/token (refresh_token)", () => {
  it("refresh rotates: a new pair, and the new access token works", async () => {
    const c = await oauthCode(userId, ["secrets:read"]);
    const first = await json<TokenBody>(await exchange(c));
    const res = await refresh(first.refresh_token, c.clientId);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const next = await json<TokenBody>(res);
    expect(next.refresh_token).not.toBe(first.refresh_token);
    expect(next.scope).toBe("secrets:read");
    expect(await authenticateAccessToken(env.DB, next.access_token, Date.now())).not.toBeNull();
  });

  it("replaying the old refresh token → invalid_grant and revokes the grant", async () => {
    const c = await oauthCode(userId);
    const first = await json<TokenBody>(await exchange(c));
    const next = await json<TokenBody>(await refresh(first.refresh_token, c.clientId));
    expect(await errorOf(await refresh(first.refresh_token, c.clientId))).toBe("invalid_grant");
    expect(await grantRevoked(c.grantId)).toBe(true);
    expect(await authenticateAccessToken(env.DB, next.access_token, Date.now())).toBeNull();
    expect(await errorOf(await refresh(next.refresh_token, c.clientId))).toBe("invalid_grant");
  });

  it("another client's refresh token or a disabled user → invalid_grant", async () => {
    const c = await oauthCode(userId);
    const first = await json<TokenBody>(await exchange(c));
    expect(await errorOf(await refresh(first.refresh_token, "someone-else"))).toBe("invalid_grant");
    await env.DB.prepare("UPDATE users SET disabled_at = ? WHERE id = ?")
      .bind(Date.now(), userId)
      .run();
    expect(await errorOf(await refresh(first.refresh_token, c.clientId))).toBe("invalid_grant");
  });
});

describe("POST /oauth/revoke", () => {
  it("returns 200 for any input and revokes the grant of a valid token", async () => {
    expect((await formPost("/oauth/revoke", { token: "garbage" })).status).toBe(200);
    expect((await formPost("/oauth/revoke", {})).status).toBe(200);
    const c = await oauthCode(userId);
    const pair = await json<TokenBody>(await exchange(c));
    const res = await formPost("/oauth/revoke", { token: pair.refresh_token });
    expect(res.status).toBe(200);
    expect(await grantRevoked(c.grantId)).toBe(true);
    expect(await authenticateAccessToken(env.DB, pair.access_token, Date.now())).toBeNull();
  });
});

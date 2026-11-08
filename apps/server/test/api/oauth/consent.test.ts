import { env } from "cloudflare:workers";
import type { OAuthAuthorizeCheckDto, OAuthGrantDto } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  api,
  auditRows,
  challengeFor,
  createServiceToken,
  createUserWithSession,
  formPost,
  json,
  jsonInit,
  oauthClient,
  REDIRECT,
  resetDb,
  VERIFIER,
} from "#test/support";

const db = env.DB;
let web: { userId: string; cookie: string };
let clientId: string;
let challenge: string;

const base = () => ({
  response_type: "code",
  client_id: clientId,
  redirect_uri: REDIRECT,
  code_challenge: challenge,
  code_challenge_method: "S256",
  state: "st-123",
});
const check = (body: object, auth: Parameters<typeof jsonInit>[2] = { cookie: web.cookie }) =>
  api("/api/v1/oauth/authorize/check", jsonInit("POST", body, auth));
const decide = (body: object, auth: Parameters<typeof jsonInit>[2] = { cookie: web.cookie }) =>
  api("/api/v1/oauth/authorize/decision", jsonInit("POST", body, auth));
const redirectOf = async (res: Response) => {
  expect(res.status).toBe(200);
  const body = await json<{ redirectTo?: string }>(res);
  expect(body.redirectTo).toBeDefined();
  return new URL(body.redirectTo as string);
};
const grantRows = () =>
  db.prepare("SELECT * FROM oauth_grants").all<{ scopes: string; user_id: string }>();

beforeEach(async () => {
  await resetDb();
  web = await createUserWithSession({ role: "member", kind: "web", email: "web@example.test" });
  clientId = (await oauthClient()).id;
  challenge = await challengeFor(VERIFIER);
});

describe("POST /api/v1/oauth/authorize/check", () => {
  it("returns the client, the redirect host and the requested scopes", async () => {
    const res = await check({ ...base(), scope: "secrets:read secrets:reveal" });
    expect(res.status).toBe(200);
    expect(await json<OAuthAuthorizeCheckDto>(res)).toEqual({
      client: { id: clientId, name: "Claude Code", redirectHost: "localhost:33418" },
      scopes: ["secrets:read", "secrets:reveal"],
      revealRequested: true,
    });
  });

  it("no scope means read and write, without reveal", async () => {
    const dto = await json<OAuthAuthorizeCheckDto>(await check(base()));
    expect(dto.scopes).toEqual(["secrets:read", "secrets:write"]);
    expect(dto.revealRequested).toBe(false);
  });

  it("a CLI session, a service token or a cookie without Origin gets 403", async () => {
    const cli = await createUserWithSession({ role: "owner", kind: "cli" });
    expect((await check(base(), { token: cli.token })).status).toBe(403);
    await api(
      "/api/v1/projects",
      jsonInit("POST", { name: "app", slug: "app" }, { token: cli.token }),
    );
    const st = await createServiceToken("app", {
      permission: "read",
      scopes: [{ environment: "dev", path: "/" }],
    });
    expect((await check(base(), { token: st.token })).status).toBe(403);
    expect((await check(base(), { cookie: web.cookie, origin: null })).status).toBe(403);
    expect(
      (await decide({ ...base(), approve: true, allowReveal: false }, { token: cli.token })).status,
    ).toBe(403);
  });

  it("an unknown client or an unregistered redirect → 400 with no redirectTo", async () => {
    for (const body of [
      { ...base(), client_id: "nope" },
      { ...base(), redirect_uri: "https://evil.example/cb" },
      { ...base(), redirect_uri: "http://localhost:33418/other" },
      { ...base(), redirect_uri: "http://127.0.0.1:33418/callback" },
    ]) {
      const res = await check(body);
      expect(res.status).toBe(400);
      const err = await json<{ error: { code: string; message: string }; redirectTo?: string }>(
        res,
      );
      expect(err.error.code).toBe("bad_request");
      expect(err.error.message).toMatch(/not registered|did not register/);
      expect(err.redirectTo).toBeUndefined();
    }
  });

  it("a loopback redirect on another port is accepted", async () => {
    const res = await check({ ...base(), redirect_uri: "http://localhost:51000/callback" });
    expect(res.status).toBe(200);
    expect((await json<OAuthAuthorizeCheckDto>(res)).client.redirectHost).toBe("localhost:51000");
  });

  it.each([
    ["code_challenge_method=plain", { code_challenge_method: "plain" }, "invalid_request"],
    ["no code_challenge", { code_challenge: undefined }, "invalid_request"],
    ["response_type=token", { response_type: "token" }, "unsupported_response_type"],
    ["another resource", { resource: "https://evil.example/mcp" }, "invalid_target"],
    ["an unknown scope", { scope: "secrets:read admin" }, "invalid_scope"],
  ])("%s → redirect with error and state", async (_n, over, error) => {
    const url = await redirectOf(await check({ ...base(), ...over }));
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT);
    expect(url.searchParams.get("error")).toBe(error);
    expect(url.searchParams.get("state")).toBe("st-123");
    expect(url.searchParams.get("code")).toBeNull();
  });

  it("resource equal to <origin>/mcp is accepted", async () => {
    expect((await check({ ...base(), resource: "http://anchor.test/mcp" })).status).toBe(200);
  });
});

describe("POST /api/v1/oauth/authorize/decision", () => {
  it("approving the same client again revokes the earlier grant and audits the count", async () => {
    await redirectOf(await decide({ ...base(), approve: true, allowReveal: false }));
    await redirectOf(await decide({ ...base(), approve: true, allowReveal: false }));
    const { results } = await db
      .prepare("SELECT revoked_at FROM oauth_grants WHERE user_id = ? ORDER BY created_at, rowid")
      .bind(web.userId)
      .all<{ revoked_at: number | null }>();
    expect(results.map((r) => r.revoked_at === null)).toEqual([false, true]);
    const counts = (await auditRows("oauth.authorized")).map(
      (r) => (JSON.parse(r.metadata ?? "{}") as { revokedGrants?: number }).revokedGrants ?? 0,
    );
    expect(counts.sort()).toEqual([0, 1]);
  });

  it("re-approval leaves other users' and other clients' grants live", async () => {
    const other = await createUserWithSession({
      role: "member",
      kind: "web",
      email: "o@example.test",
    });
    await redirectOf(
      await decide({ ...base(), approve: true, allowReveal: false }, { cookie: other.cookie }),
    );
    const second = (await oauthClient()).id;
    await redirectOf(
      await decide({ ...base(), client_id: second, approve: true, allowReveal: false }),
    );
    await redirectOf(await decide({ ...base(), approve: true, allowReveal: false }));
    const live = await db
      .prepare("SELECT COUNT(*) AS n FROM oauth_grants WHERE revoked_at IS NULL")
      .first<{ n: number }>();
    expect(live?.n).toBe(3);
  });

  const scopesOfOnlyGrant = async () => {
    const { results } = await grantRows();
    expect(results).toHaveLength(1);
    return results[0]?.scopes;
  };

  it("approve returns a code redirect that the token endpoint accepts", async () => {
    const url = await redirectOf(await decide({ ...base(), approve: true, allowReveal: false }));
    expect(url.searchParams.get("state")).toBe("st-123");
    const code = url.searchParams.get("code") ?? "";
    expect(code).toMatch(/^anc_oac_/);
    const res = await formPost("/oauth/token", {
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: VERIFIER,
    });
    expect(res.status).toBe(200);
    expect((await grantRows()).results[0]?.user_id).toBe(web.userId);
  });

  it("the code is bound to the loopback port the client used", async () => {
    const other = "http://localhost:51000/callback";
    const url = await redirectOf(
      await decide({ ...base(), redirect_uri: other, approve: true, allowReveal: false }),
    );
    expect(`${url.origin}${url.pathname}`).toBe(other);
  });

  it("reveal is granted only when requested and ticked", async () => {
    const reveal = { ...base(), scope: "secrets:read secrets:write secrets:reveal" };
    await decide({ ...reveal, approve: true, allowReveal: false });
    expect(await scopesOfOnlyGrant()).toBe("secrets:read secrets:write");
    await db.prepare("DELETE FROM oauth_grants").run();

    await decide({ ...reveal, approve: true, allowReveal: true });
    expect(await scopesOfOnlyGrant()).toBe("secrets:read secrets:write secrets:reveal");
    await db.prepare("DELETE FROM oauth_grants").run();

    await decide({ ...base(), approve: true, allowReveal: true });
    expect(await scopesOfOnlyGrant()).toBe("secrets:read secrets:write");
  });

  it("deny → access_denied with the original state and no grant", async () => {
    const url = await redirectOf(await decide({ ...base(), approve: false, allowReveal: false }));
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("st-123");
    expect((await grantRows()).results).toHaveLength(0);
    const [row] = await auditRows("oauth.denied");
    expect(JSON.parse(row?.metadata ?? "{}")).toEqual({ clientId, clientName: "Claude Code" });
  });

  it("a request that fails the check is never approved", async () => {
    const res = await decide({ ...base(), client_id: "nope", approve: true, allowReveal: false });
    expect(res.status).toBe(400);
    const url = await redirectOf(
      await decide({ ...base(), scope: "admin", approve: true, allowReveal: false }),
    );
    expect(url.searchParams.get("error")).toBe("invalid_scope");
    expect((await grantRows()).results).toHaveLength(0);
  });

  it("approval is audited with the client and scopes, never the code", async () => {
    const url = await redirectOf(await decide({ ...base(), approve: true, allowReveal: false }));
    const code = url.searchParams.get("code") ?? "";
    const rows = await auditRows("oauth.authorized");
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]?.metadata ?? "{}")).toEqual({
      clientId,
      clientName: "Claude Code",
      scopes: ["secrets:read", "secrets:write"],
    });
    expect(JSON.stringify(await auditRows())).not.toContain(code);
    expect(rows[0]?.actor_id).toBe(web.userId);
  });
});

describe("/api/v1/oauth/grants", () => {
  const approve = async (cookie = web.cookie) => {
    await decide({ ...base(), approve: true, allowReveal: false }, { cookie });
  };

  it("lists the user's live grants and revokes one", async () => {
    await approve();
    const list = await api("/api/v1/oauth/grants", { headers: { cookie: web.cookie } });
    expect(list.status).toBe(200);
    const { grants } = await json<{ grants: OAuthGrantDto[] }>(list);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      clientName: "Claude Code",
      scopes: ["secrets:read", "secrets:write"],
      lastUsedAt: null,
    });
    const id = grants[0]?.id ?? "";
    const del = await api(
      `/api/v1/oauth/grants/${id}`,
      jsonInit("DELETE", undefined, { cookie: web.cookie }),
    );
    expect(del.status).toBe(204);
    const after = await json<{ grants: OAuthGrantDto[] }>(
      await api("/api/v1/oauth/grants", { headers: { cookie: web.cookie } }),
    );
    expect(after.grants).toEqual([]);
    const [row] = await auditRows("oauth.revoked");
    expect(JSON.parse(row?.metadata ?? "{}")).toEqual({ clientId, clientName: "Claude Code" });
    expect(row?.target).toBe(id);
  });

  it("another user's grant → 404 and stays live", async () => {
    const other = await createUserWithSession({ kind: "web", email: "other@example.test" });
    await approve(other.cookie);
    const { results } = await grantRows();
    const id = (results[0] as unknown as { id: string }).id;
    const del = await api(
      `/api/v1/oauth/grants/${id}`,
      jsonInit("DELETE", undefined, { cookie: web.cookie }),
    );
    expect(del.status).toBe(404);
    const row = await db
      .prepare("SELECT revoked_at FROM oauth_grants WHERE id = ?")
      .bind(id)
      .first();
    expect(row).toEqual({ revoked_at: null });
    const mine = await json<{ grants: OAuthGrantDto[] }>(
      await api("/api/v1/oauth/grants", { headers: { cookie: web.cookie } }),
    );
    expect(mine.grants).toEqual([]);
  });
});

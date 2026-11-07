import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "#src/lib/random";
import { type OAuthScope, parseScopes } from "#src/oauth/scopes";
import {
  ACCESS_TTL_MS,
  authenticateAccessToken,
  CODE_TTL_MS,
  createGrant,
  getClient,
  issueCode,
  issueTokenPair,
  purgeOAuth,
  REFRESH_TTL_MS,
  redeemCode,
  registerClient,
  revokeGrant,
  rotateRefresh,
} from "#src/oauth/store";
import { createUserWithSession, resetDb } from "#test/support";

const db = env.DB;
const T0 = 1_800_000_000_000;
let userId: string;
let clientId: string;

async function grant(scopes: OAuthScope[] = ["secrets:read", "secrets:write"]) {
  return createGrant(db, { userId, clientId, scopes, now: T0 });
}

beforeEach(async () => {
  await resetDb();
  ({ userId } = await createUserWithSession());
  const client = await registerClient(db, {
    name: "Claude Code",
    redirectUris: ["http://localhost:3000/callback"],
    ip: "1.2.3.4",
    now: T0,
  });
  clientId = client.id;
});

describe("OAuth store", () => {
  it("registerClient stores the client and getClient reads it back", async () => {
    const client = await getClient(db, clientId);
    expect(client).toMatchObject({
      id: clientId,
      name: "Claude Code",
      redirect_uris: ["http://localhost:3000/callback"],
    });
    expect(await getClient(db, "nope")).toBeNull();
  });

  it("only hashes are stored", async () => {
    const grantId = await grant();
    const code = await issueCode(db, {
      grantId,
      redirectUri: "http://localhost:3000/callback",
      codeChallenge: "challenge",
      now: T0,
    });
    const pair = await issueTokenPair(db, grantId, T0);
    expect(code).toMatch(/^anc_oac_[A-Za-z0-9_-]{43}$/);
    expect(pair.accessToken).toMatch(/^anc_oat_[A-Za-z0-9_-]{43}$/);
    expect(pair.refreshToken).toMatch(/^anc_ort_[A-Za-z0-9_-]{43}$/);
    expect(pair.expiresIn).toBe(3600);
    const dump = JSON.stringify([
      (await db.prepare("SELECT * FROM oauth_codes").all()).results,
      (await db.prepare("SELECT * FROM oauth_tokens").all()).results,
    ]);
    for (const raw of [code, pair.accessToken, pair.refreshToken]) {
      expect(dump).not.toContain(raw);
      expect(dump).toContain(await sha256Hex(raw));
    }
  });

  it('a code redeems once; the second redeem is "reused" and revokes the grant', async () => {
    const grantId = await grant();
    const code = await issueCode(db, {
      grantId,
      redirectUri: "http://localhost:3000/callback",
      codeChallenge: "challenge",
      now: T0,
    });
    const pair = await issueTokenPair(db, grantId, T0);
    const first = await redeemCode(db, { code, now: T0 + 1000 });
    expect(first).toMatchObject({
      grant_id: grantId,
      redirect_uri: "http://localhost:3000/callback",
      code_challenge: "challenge",
      client_id: clientId,
      user_id: userId,
      scopes: "secrets:read secrets:write",
    });
    expect(await redeemCode(db, { code, now: T0 + 2000 })).toBe("reused");
    expect(await authenticateAccessToken(db, pair.accessToken, T0 + 3000)).toBeNull();
  });

  it("an expired or unknown code is null", async () => {
    const grantId = await grant();
    const code = await issueCode(db, {
      grantId,
      redirectUri: "http://localhost:3000/callback",
      codeChallenge: "c",
      now: T0,
    });
    expect(await redeemCode(db, { code, now: T0 + CODE_TTL_MS })).toBeNull();
    expect(await redeemCode(db, { code: "anc_oac_unknown", now: T0 })).toBeNull();
  });

  it('rotateRefresh marks the old token used and a second rotate returns "reused"', async () => {
    const grantId = await grant();
    const pair = await issueTokenPair(db, grantId, T0);
    expect(
      await rotateRefresh(db, { refreshToken: pair.refreshToken, clientId, now: T0 + 1 }),
    ).toEqual({
      grantId,
    });
    const next = await issueTokenPair(db, grantId, T0 + 1);
    expect(
      await rotateRefresh(db, { refreshToken: pair.refreshToken, clientId, now: T0 + 2 }),
    ).toBe("reused");
    // Replay revokes the whole grant: the newest tokens stop working too.
    expect(await authenticateAccessToken(db, next.accessToken, T0 + 3)).toBeNull();
    expect(
      await rotateRefresh(db, { refreshToken: next.refreshToken, clientId, now: T0 + 4 }),
    ).toBeNull();
  });

  it("rotateRefresh refuses another client, an access token, and an expired refresh token", async () => {
    const grantId = await grant();
    const pair = await issueTokenPair(db, grantId, T0);
    expect(
      await rotateRefresh(db, { refreshToken: pair.refreshToken, clientId: "other", now: T0 }),
    ).toBeNull();
    expect(
      await rotateRefresh(db, { refreshToken: pair.accessToken, clientId, now: T0 }),
    ).toBeNull();
    expect(
      await rotateRefresh(db, {
        refreshToken: pair.refreshToken,
        clientId,
        now: T0 + REFRESH_TTL_MS,
      }),
    ).toBeNull();
  });

  it("authenticateAccessToken returns the grant and is null after revokeGrant / expiry / for a disabled user", async () => {
    const grantId = await grant(["secrets:read"]);
    const pair = await issueTokenPair(db, grantId, T0);
    expect(await authenticateAccessToken(db, pair.accessToken, T0 + 1)).toEqual({
      userId,
      grantId,
      clientId,
      scopes: ["secrets:read"],
    });
    expect(await authenticateAccessToken(db, pair.refreshToken, T0 + 1)).toBeNull();
    expect(await authenticateAccessToken(db, pair.accessToken, T0 + ACCESS_TTL_MS)).toBeNull();

    await db.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").bind(T0, userId).run();
    expect(await authenticateAccessToken(db, pair.accessToken, T0 + 1)).toBeNull();
    await db.prepare("UPDATE users SET disabled_at = NULL WHERE id = ?").bind(userId).run();
    expect(await authenticateAccessToken(db, pair.accessToken, T0 + 1)).not.toBeNull();

    await revokeGrant(db, grantId, T0 + 2);
    expect(await authenticateAccessToken(db, pair.accessToken, T0 + 3)).toBeNull();
  });

  it("authenticateAccessToken sets last_used_at on the grant", async () => {
    const grantId = await grant();
    const pair = await issueTokenPair(db, grantId, T0);
    await authenticateAccessToken(db, pair.accessToken, T0 + 5);
    const row = await db
      .prepare("SELECT last_used_at FROM oauth_grants WHERE id = ?")
      .bind(grantId)
      .first();
    expect(row).toEqual({ last_used_at: T0 + 5 });
  });

  it("parseScopes defaults, dedupes and rejects unknown scopes", () => {
    expect(parseScopes(undefined)).toEqual(["secrets:read", "secrets:write"]);
    expect(parseScopes("")).toEqual(["secrets:read", "secrets:write"]);
    expect(parseScopes("secrets:reveal  secrets:read secrets:read")).toEqual([
      "secrets:reveal",
      "secrets:read",
    ]);
    expect(parseScopes("secrets:read admin")).toBeNull();
  });

  it("purgeOAuth drops expired codes and tokens and clients older than 24 h without grants", async () => {
    const grantId = await grant();
    await issueCode(db, {
      grantId,
      redirectUri: "http://localhost:3000/callback",
      codeChallenge: "c",
      now: T0,
    });
    await issueTokenPair(db, grantId, T0);
    const stale = await registerClient(db, {
      name: "stale",
      redirectUris: ["https://a.example/cb"],
      ip: null,
      now: T0,
    });
    const fresh = await registerClient(db, {
      name: "fresh",
      redirectUris: ["https://a.example/cb"],
      ip: null,
      now: T0 + 86_400_000,
    });
    const purged = await purgeOAuth(db, T0 + 86_400_001);
    // the code and the access token expired; the refresh token lives 30 days; the stale client goes
    expect(purged).toBe(3);
    expect(await getClient(db, stale.id)).toBeNull();
    expect(await getClient(db, fresh.id)).not.toBeNull();
    expect(await getClient(db, clientId)).not.toBeNull();
    const kinds = await db.prepare("SELECT kind FROM oauth_tokens").all<{ kind: string }>();
    expect(kinds.results.map((r) => r.kind)).toEqual(["refresh"]);
  });
});

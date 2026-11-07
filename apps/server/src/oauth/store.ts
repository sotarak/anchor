import { newId, newToken, sha256Hex } from "../lib/random";
import { type OAuthScope, splitScopes } from "./scopes";

/**
 * Storage for Anchor's OAuth 2.1 authorization server (spec 2026-11-07-v0.4.0-mcp-oauth).
 * Codes and tokens are random 256-bit bearer secrets; only their sha256 hex is stored. Every
 * check reads D1, so a revoked grant stops working on the next request.
 */
export const ACCESS_TTL_MS = 3_600_000;
export const REFRESH_TTL_MS = 2_592_000_000;
export const CODE_TTL_MS = 300_000;
/** A client nobody approved within this window is purged. */
export const PENDING_CLIENT_TTL_MS = 86_400_000;
const LAST_USED_THROTTLE_MS = 60_000;

export const ACCESS_TOKEN_PREFIX = "anc_oat_";
export const REFRESH_TOKEN_PREFIX = "anc_ort_";

export type OAuthClientRow = {
  id: string;
  name: string;
  redirect_uris: string[];
  ip: string | null;
  created_at: number;
  last_used_at: number | null;
};

/** A redeemed code with the grant it belongs to. */
export type CodeRow = {
  grant_id: string;
  redirect_uri: string;
  code_challenge: string;
  client_id: string;
  user_id: string;
  scopes: string;
  grant_revoked_at: number | null;
  user_disabled_at: number | null;
};

export type OAuthAuth = {
  userId: string;
  grantId: string;
  clientId: string;
  scopes: OAuthScope[];
};

type StoredClient = Omit<OAuthClientRow, "redirect_uris"> & { redirect_uris: string };

export async function registerClient(
  db: D1Database,
  i: { name: string; redirectUris: string[]; ip: string | null; now: number },
): Promise<OAuthClientRow> {
  const row: OAuthClientRow = {
    id: newId(),
    name: i.name,
    redirect_uris: i.redirectUris,
    ip: i.ip,
    created_at: i.now,
    last_used_at: null,
  };
  await db
    .prepare(
      "INSERT INTO oauth_clients (id, name, redirect_uris, ip, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(row.id, row.name, JSON.stringify(row.redirect_uris), row.ip, row.created_at)
    .run();
  return row;
}

export async function getClient(db: D1Database, id: string): Promise<OAuthClientRow | null> {
  const row = await db
    .prepare("SELECT * FROM oauth_clients WHERE id = ?")
    .bind(id)
    .first<StoredClient>();
  return row ? { ...row, redirect_uris: JSON.parse(row.redirect_uris) as string[] } : null;
}

/** Clients registered in the last 24 hours that nobody approved yet: overall and from one IP. */
export async function countPendingClients(
  db: D1Database,
  ip: string | null,
  now: number,
): Promise<{ total: number; fromIp: number }> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(c.ip = ?2), 0) AS fromIp
       FROM oauth_clients c
       WHERE c.created_at > ?1
         AND NOT EXISTS (SELECT 1 FROM oauth_grants g WHERE g.client_id = c.id)`,
    )
    .bind(now - PENDING_CLIENT_TTL_MS, ip)
    .first<{ total: number; fromIp: number }>();
  return { total: row?.total ?? 0, fromIp: row?.fromIp ?? 0 };
}

export async function createGrant(
  db: D1Database,
  i: { userId: string; clientId: string; scopes: OAuthScope[]; now: number },
): Promise<string> {
  const id = newId();
  await db.batch([
    db
      .prepare(
        "INSERT INTO oauth_grants (id, user_id, client_id, scopes, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(id, i.userId, i.clientId, i.scopes.join(" "), i.now),
    db.prepare("UPDATE oauth_clients SET last_used_at = ? WHERE id = ?").bind(i.now, i.clientId),
  ]);
  return id;
}

export async function issueCode(
  db: D1Database,
  i: { grantId: string; redirectUri: string; codeChallenge: string; now: number },
): Promise<string> {
  const code = newToken("anc_oac");
  await db
    .prepare(
      `INSERT INTO oauth_codes (id, grant_id, redirect_uri, code_challenge, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      await sha256Hex(code),
      i.grantId,
      i.redirectUri,
      i.codeChallenge,
      i.now,
      i.now + CODE_TTL_MS,
    )
    .run();
  return code;
}

/**
 * Marks a code used, once: the single-winner UPDATE decides between concurrent redeems. A code
 * presented again is "reused" and its grant is revoked, since someone else may hold it (RFC 6749
 * §4.1.2). Unknown or expired codes are null. The caller still checks client, redirect URI, PKCE,
 * grant and user state.
 */
export async function redeemCode(
  db: D1Database,
  i: { code: string; now: number },
): Promise<CodeRow | "reused" | null> {
  const id = await sha256Hex(i.code);
  const won = await db
    .prepare(
      "UPDATE oauth_codes SET used_at = ?1 WHERE id = ?2 AND used_at IS NULL AND expires_at > ?1",
    )
    .bind(i.now, id)
    .run();
  const row = await db
    .prepare(
      `SELECT c.grant_id, c.redirect_uri, c.code_challenge, c.used_at, g.client_id, g.user_id,
         g.scopes, g.revoked_at AS grant_revoked_at, u.disabled_at AS user_disabled_at
       FROM oauth_codes c
       JOIN oauth_grants g ON g.id = c.grant_id
       JOIN users u ON u.id = g.user_id
       WHERE c.id = ?`,
    )
    .bind(id)
    .first<CodeRow & { used_at: number | null }>();
  if (!row) return null;
  if (won.meta.changes !== 1) {
    if (row.used_at === null) return null; // expired, never used
    await revokeGrant(db, row.grant_id, i.now);
    return "reused";
  }
  const { used_at: _used, ...code } = row;
  return code;
}

export async function issueTokenPair(
  db: D1Database,
  grantId: string,
  now: number,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: 3600 }> {
  const accessToken = newToken("anc_oat");
  const refreshToken = newToken("anc_ort");
  const insert = db.prepare(
    "INSERT INTO oauth_tokens (id, grant_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
  );
  await db.batch([
    insert.bind(await sha256Hex(accessToken), grantId, "access", now, now + ACCESS_TTL_MS),
    insert.bind(await sha256Hex(refreshToken), grantId, "refresh", now, now + REFRESH_TTL_MS),
  ]);
  return { accessToken, refreshToken, expiresIn: 3600 };
}

/**
 * Rotates a refresh token: marks it used once and returns its grant, for which the caller issues
 * a new pair. Presenting a token that was already rotated revokes the whole grant ("reused"):
 * either the client or an attacker holds a copy. Null for unknown, expired, another client's or
 * a revoked grant's token, or a disabled user.
 */
export async function rotateRefresh(
  db: D1Database,
  i: { refreshToken: string; clientId: string; now: number },
): Promise<{ grantId: string } | "reused" | null> {
  if (!i.refreshToken.startsWith(REFRESH_TOKEN_PREFIX)) return null;
  const id = await sha256Hex(i.refreshToken);
  const row = await db
    .prepare(
      `SELECT t.grant_id, t.expires_at, t.used_at, g.client_id, g.revoked_at, u.disabled_at
       FROM oauth_tokens t
       JOIN oauth_grants g ON g.id = t.grant_id
       JOIN users u ON u.id = g.user_id
       WHERE t.id = ? AND t.kind = 'refresh'`,
    )
    .bind(id)
    .first<{
      grant_id: string;
      expires_at: number;
      used_at: number | null;
      client_id: string;
      revoked_at: number | null;
      disabled_at: number | null;
    }>();
  if (!row || row.client_id !== i.clientId || row.revoked_at !== null) return null;
  if (row.disabled_at !== null || row.expires_at <= i.now) return null;
  const won = await db
    .prepare("UPDATE oauth_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL")
    .bind(i.now, id)
    .run();
  if (won.meta.changes !== 1) {
    await revokeGrant(db, row.grant_id, i.now);
    return "reused";
  }
  return { grantId: row.grant_id };
}

export async function revokeGrant(db: D1Database, grantId: string, now: number): Promise<boolean> {
  const result = await db
    .prepare("UPDATE oauth_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .bind(now, grantId)
    .run();
  return result.meta.changes === 1;
}

/** The grant a code-or-token string belongs to (any kind, any state), for revocation. */
export async function findGrantIdByToken(db: D1Database, token: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT grant_id FROM oauth_tokens WHERE id = ?")
    .bind(await sha256Hex(token))
    .first<{ grant_id: string }>();
  return row?.grant_id ?? null;
}

/**
 * Resolves an `anc_oat_` bearer: null when unknown, expired, not an access token, its grant is
 * revoked or its user is disabled. Records the grant's last use (throttled to once a minute).
 */
export async function authenticateAccessToken(
  db: D1Database,
  token: string,
  now: number,
): Promise<OAuthAuth | null> {
  if (!token.startsWith(ACCESS_TOKEN_PREFIX)) return null;
  const row = await db
    .prepare(
      `SELECT g.id AS grant_id, g.user_id, g.client_id, g.scopes, g.last_used_at
       FROM oauth_tokens t
       JOIN oauth_grants g ON g.id = t.grant_id
       JOIN users u ON u.id = g.user_id
       WHERE t.id = ? AND t.kind = 'access' AND t.expires_at > ?
         AND g.revoked_at IS NULL AND u.disabled_at IS NULL`,
    )
    .bind(await sha256Hex(token), now)
    .first<{
      grant_id: string;
      user_id: string;
      client_id: string;
      scopes: string;
      last_used_at: number | null;
    }>();
  if (!row) return null;
  if (row.last_used_at === null || row.last_used_at < now - LAST_USED_THROTTLE_MS) {
    await db
      .prepare(
        "UPDATE oauth_grants SET last_used_at = ? WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)",
      )
      .bind(now, row.grant_id, now - LAST_USED_THROTTLE_MS)
      .run();
  }
  return {
    userId: row.user_id,
    grantId: row.grant_id,
    clientId: row.client_id,
    scopes: splitScopes(row.scopes),
  };
}

/** Daily cleanup: expired codes and tokens, and clients nobody approved within 24 hours. */
export async function purgeOAuth(db: D1Database, now: number): Promise<number> {
  const results = await db.batch([
    db.prepare("DELETE FROM oauth_codes WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM oauth_tokens WHERE expires_at <= ?").bind(now),
    db
      .prepare(
        `DELETE FROM oauth_clients WHERE created_at <= ?
           AND NOT EXISTS (SELECT 1 FROM oauth_grants g WHERE g.client_id = oauth_clients.id)`,
      )
      .bind(now - PENDING_CLIENT_TTL_MS),
  ]);
  return results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
}

/** The grant's scopes as stored (space-separated), or null for an unknown grant. */
export async function getGrantScopes(db: D1Database, grantId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT scopes FROM oauth_grants WHERE id = ?")
    .bind(grantId)
    .first<{ scopes: string }>();
  return row?.scopes ?? null;
}

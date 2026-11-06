import type { InstanceRole, SessionDto } from "@anchor/shared";
import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import type { Principal } from "../env";
import { newSessionToken, sha256Hex } from "../lib/random";

export const SESSION_COOKIE = "__Host-anchor_session";
export const SESSION_TTL_MS = { web: 7 * 86_400_000, cli: 30 * 86_400_000 } as const;
const TOKEN_PREFIX = "anc_s_";

export async function createSession(
  db: D1Database,
  userId: string,
  kind: "web" | "cli",
  userAgent: string | null,
  now: number,
): Promise<{ token: string; expiresAt: number }> {
  const token = newSessionToken();
  const expiresAt = now + SESSION_TTL_MS[kind];
  await db
    .prepare(
      "INSERT INTO sessions (id, user_id, kind, user_agent, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(await sha256Hex(token), userId, kind, userAgent, now, expiresAt, now)
    .run();
  return { token, expiresAt };
}

/** Resolves a presented token to its user. Null for unknown, malformed or expired sessions. */
export async function findPrincipalBySessionToken(
  db: D1Database,
  token: string,
  now: number,
): Promise<Principal | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const id = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT s.id AS session_id, u.id AS user_id, u.email, u.name, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ? AND u.disabled_at IS NULL`,
    )
    .bind(id, now)
    .first<{
      session_id: string;
      user_id: string;
      email: string;
      name: string;
      role: InstanceRole;
    }>();
  if (!row) return null;
  await db.prepare("UPDATE sessions SET last_used_at = ? WHERE id = ?").bind(now, id).run();
  return {
    type: "user",
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role,
    sessionId: row.session_id,
  };
}

const SHORT_ID = /^[0-9a-f]{16}$/;

/** The user's unexpired sessions, newest first. ids are the first 16 hex chars of the stored hash. */
export async function listSessions(
  db: D1Database,
  userId: string,
  currentSessionId: string,
  now: number = Date.now(),
): Promise<SessionDto[]> {
  const { results } = await db
    .prepare(
      `SELECT id, kind, user_agent, created_at, last_used_at, expires_at FROM sessions
       WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC, id DESC`,
    )
    .bind(userId, now)
    .all<{
      id: string;
      kind: "web" | "cli";
      user_agent: string | null;
      created_at: number;
      last_used_at: number | null;
      expires_at: number;
    }>();
  return results.map((r) => ({
    id: r.id.slice(0, 16),
    kind: r.kind,
    userAgent: r.user_agent,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    expiresAt: r.expires_at,
    current: r.id === currentSessionId,
  }));
}

export function isSessionShortId(shortId: string): boolean {
  return SHORT_ID.test(shortId);
}

/** Deletes one of the user's own sessions by its short id. Never matches another user's sessions. */
export async function revokeSessionByShortId(
  db: D1Database,
  userId: string,
  shortId: string,
): Promise<boolean> {
  if (!isSessionShortId(shortId)) throw new Error("invalid session short id");
  const row = await db
    .prepare("DELETE FROM sessions WHERE user_id = ? AND substr(id, 1, 16) = ? RETURNING id")
    .bind(userId, shortId)
    .first<{ id: string }>();
  return row !== null;
}

/** Deletes every session of the user, optionally keeping one (the caller's own). */
export async function revokeUserSessions(
  db: D1Database,
  userId: string,
  exceptSessionId?: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?")
    .bind(userId, exceptSessionId ?? "")
    .run();
}

export async function revokeSession(db: D1Database, token: string): Promise<void> {
  await db
    .prepare("DELETE FROM sessions WHERE id = ?")
    .bind(await sha256Hex(token))
    .run();
}

export function setSessionCookie(c: Context, token: string, expiresAt: number): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true, httpOnly: true, sameSite: "Strict" });
}

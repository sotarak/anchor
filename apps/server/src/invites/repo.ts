import type { InstanceRole, InviteDto } from "@anchor/shared";
import { ApiError } from "../lib/errors";
import { newId, newToken, sha256Hex, tokenPrefix } from "../lib/random";

export type InviteRow = {
  id: string;
  email: string;
  role: InstanceRole;
  token_hash: string;
  token_prefix: string;
  created_by: string | null;
  created_at: number;
  expires_at: number;
  accepted_at: number | null;
  revoked_at: number | null;
};

export const INVITE_TTL_MS = 259_200_000; // 72 h
const TOKEN_PREFIX = "anc_inv_";

/**
 * Live = not accepted, not revoked, not expired, and its creator could still issue it now
 * (active; an owner, or an admin for a non-owner role). So disabling, demoting or deleting an
 * admin kills their pending invites. Parameter ?now must be bound by the caller.
 */
const LIVE = `accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
  AND EXISTS (SELECT 1 FROM users creator
    WHERE creator.id = invites.created_by AND creator.disabled_at IS NULL
      AND (creator.role = 'owner' OR (creator.role = 'admin' AND invites.role != 'owner')))`;

/**
 * Inserts the invite unless a live invite for the same email exists (409), atomically: the
 * check is part of the INSERT, so two concurrent creates cannot both succeed.
 */
export async function createInvite(
  db: D1Database,
  input: { email: string; role: InstanceRole; createdBy: string },
  now: number,
): Promise<{ row: InviteRow; token: string }> {
  const token = newToken("anc_inv");
  const row: InviteRow = {
    id: newId(),
    email: input.email,
    role: input.role,
    token_hash: await sha256Hex(token),
    token_prefix: tokenPrefix(token),
    created_by: input.createdBy,
    created_at: now,
    expires_at: now + INVITE_TTL_MS,
    accepted_at: null,
    revoked_at: null,
  };
  const inserted = await db
    .prepare(
      `INSERT INTO invites (id, email, role, token_hash, token_prefix, created_by, created_at, expires_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM invites WHERE email = ? AND ${LIVE})
       RETURNING id`,
    )
    .bind(
      row.id,
      row.email,
      row.role,
      row.token_hash,
      row.token_prefix,
      row.created_by,
      row.created_at,
      row.expires_at,
      row.email,
      now,
    )
    .first<{ id: string }>();
  if (!inserted) throw new ApiError(409, "conflict", "A pending invite exists; revoke it first");
  return { row, token };
}

export async function listInvites(db: D1Database): Promise<InviteRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM invites ORDER BY created_at DESC, id DESC")
    .all<InviteRow>();
  return results;
}

export function getInvite(db: D1Database, id: string): Promise<InviteRow | null> {
  return db.prepare("SELECT * FROM invites WHERE id = ?").bind(id).first<InviteRow>();
}

/** True when this call revoked a pending invite; false when unknown, used or already revoked. */
export async function revokeInvite(db: D1Database, id: string, now: number): Promise<boolean> {
  const row = await db
    .prepare(
      "UPDATE invites SET revoked_at = ? WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id",
    )
    .bind(now, id)
    .first<{ id: string }>();
  return row !== null;
}

export async function findValidInvite(
  db: D1Database,
  token: string,
  now: number,
): Promise<InviteRow | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  return db
    .prepare(`SELECT * FROM invites WHERE token_hash = ? AND ${LIVE}`)
    .bind(await sha256Hex(token), now)
    .first<InviteRow>();
}

/**
 * Creates the invited user and consumes the invite in one batch (one transaction). The user is
 * inserted only from a live invite whose email is still free; the invite is marked accepted only
 * if that exact user row now exists. Returns the new user id, or null when either step did nothing.
 */
export async function acceptInvite(
  db: D1Database,
  token: string,
  input: { name: string; passwordHash: string },
  now: number,
): Promise<string | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const tokenHash = await sha256Hex(token);
  const userId = newId();
  const [insertUser, markAccepted] = await db.batch([
    db
      .prepare(
        `INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
         SELECT ?, email, ?, ?, role, ?, ? FROM invites
         WHERE token_hash = ? AND ${LIVE}
           AND NOT EXISTS (SELECT 1 FROM users WHERE email = invites.email)`,
      )
      .bind(userId, input.name, input.passwordHash, now, now, tokenHash, now),
    db
      .prepare(
        `UPDATE invites SET accepted_at = ?
         WHERE token_hash = ? AND ${LIVE} AND EXISTS (SELECT 1 FROM users WHERE id = ?)`,
      )
      .bind(now, tokenHash, now, userId),
  ]);
  return insertUser?.meta.changes === 1 && markAccepted?.meta.changes === 1 ? userId : null;
}

export function toInviteDto(row: InviteRow): InviteDto {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    tokenPrefix: row.token_prefix,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
  };
}

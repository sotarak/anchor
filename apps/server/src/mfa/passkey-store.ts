import type { PasskeyDto } from "@anchor/shared";
import { isUniqueViolation, toBytes } from "../lib/d1";
import type { NewPasskey } from "./webauthn";

/** Passkeys registered as a second factor; each works only on its rp_id (hostname). */
export const MAX_PASSKEYS = 20;

export type PasskeyRow = {
  id: string;
  userId: string;
  rpId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[] | null;
  name: string;
  backedUp: boolean;
  createdAt: number;
  lastUsedAt: number | null;
};

type DbRow = {
  id: string;
  user_id: string;
  rp_id: string;
  public_key: unknown;
  counter: number;
  transports: string | null;
  name: string;
  backed_up: number;
  created_at: number;
  last_used_at: number | null;
};

const COLUMNS =
  "id, user_id, rp_id, public_key, counter, transports, name, backed_up, created_at, last_used_at";

function parseTransports(raw: string | null): string[] | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) && v.every((t) => typeof t === "string") ? v : null;
  } catch {
    return null;
  }
}

function fromDb(r: DbRow): PasskeyRow {
  return {
    id: r.id,
    userId: r.user_id,
    rpId: r.rp_id,
    publicKey: toBytes(r.public_key),
    counter: r.counter,
    transports: parseTransports(r.transports),
    name: r.name,
    backedUp: r.backed_up === 1,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  };
}

/** Inserts unless the user already has MAX_PASSKEYS (checked in the same statement). */
export async function insertPasskey(
  db: D1Database,
  userId: string,
  rpId: string,
  name: string,
  p: NewPasskey,
  now: number,
): Promise<"ok" | "limit" | "duplicate"> {
  try {
    const row = await db
      .prepare(
        `INSERT INTO webauthn_credentials (${COLUMNS})
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL
         WHERE (SELECT COUNT(*) FROM webauthn_credentials WHERE user_id = ?2) < ?10
         RETURNING id`,
      )
      .bind(
        p.id,
        userId,
        rpId,
        p.publicKey,
        p.counter,
        p.transports ? JSON.stringify(p.transports) : null,
        name,
        p.backedUp ? 1 : 0,
        now,
        MAX_PASSKEYS,
      )
      .first();
    return row ? "ok" : "limit";
  } catch (err) {
    if (isUniqueViolation(err)) return "duplicate";
    throw err;
  }
}

export async function listPasskeys(db: D1Database, userId: string): Promise<PasskeyRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLUMNS} FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at, id`,
    )
    .bind(userId)
    .all<DbRow>();
  return results.map(fromDb);
}

/** The user's own passkey by credential id; never another user's. */
export async function findPasskey(
  db: D1Database,
  userId: string,
  id: string,
): Promise<PasskeyRow | null> {
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM webauthn_credentials WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .first<DbRow>();
  return row ? fromDb(row) : null;
}

export async function touchPasskey(
  db: D1Database,
  id: string,
  counter: number,
  now: number,
): Promise<void> {
  await db
    .prepare("UPDATE webauthn_credentials SET counter = ?, last_used_at = ? WHERE id = ?")
    .bind(counter, now, id)
    .run();
}

export async function deletePasskey(db: D1Database, userId: string, id: string): Promise<boolean> {
  const row = await db
    .prepare("DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ? RETURNING id")
    .bind(id, userId)
    .first();
  return row !== null;
}

export function toPasskeyDto(row: PasskeyRow, rpId: string): PasskeyDto {
  return {
    id: row.id,
    name: row.name,
    rpId: row.rpId,
    usableHere: row.rpId === rpId,
    backedUp: row.backedUp,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}

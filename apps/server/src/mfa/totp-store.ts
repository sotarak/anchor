import { open, seal } from "../crypto/aead";
import { type RootKeyring, rootKeyFor } from "../crypto/keyring";
import { toBytes } from "../lib/d1";
import { IntegrityError } from "../lib/errors";
import { randomBytes } from "../lib/random";
import { matchTotp, TOTP_SECRET_BYTES } from "./totp";

/**
 * The authenticator-app secret (spec 2026-11-22-v0.6.0-mfa). The server must read it to check
 * codes, so it is sealed by the root key with AAD bound to the user: a D1 dump does not reveal
 * it, and a row copied to another user does not open. Every accepted time step is recorded and a
 * step at or below it is refused, in one conditional UPDATE, so a code works once even under
 * concurrent use.
 */
type Row = { root_key_id: string; iv: unknown; secret_ct: unknown };

export function totpAad(userId: string): string {
  return `anchor/totp/v1|${userId}`;
}

async function openSecret(keyring: RootKeyring, userId: string, row: Row): Promise<Uint8Array> {
  const fail = () => new IntegrityError("totp secret open failed", { userId });
  const key = rootKeyFor(keyring, row.root_key_id);
  if (!key) throw fail();
  try {
    return await open(
      key,
      { iv: toBytes(row.iv), ciphertext: toBytes(row.secret_ct) },
      totpAad(userId),
    );
  } catch {
    throw fail();
  }
}

/** A new pending secret (replacing a pending one); null when a confirmed one exists. */
export async function startTotpEnrollment(
  db: D1Database,
  keyring: RootKeyring,
  userId: string,
  now: number,
): Promise<Uint8Array | null> {
  const secret = randomBytes(TOTP_SECRET_BYTES);
  const sealed = await seal(keyring.current.key, secret, totpAad(userId));
  const row = await db
    .prepare(
      `INSERT INTO totp_credentials (user_id, root_key_id, iv, secret_ct, confirmed_at, last_step, created_at)
       VALUES (?1, ?2, ?3, ?4, NULL, NULL, ?5)
       ON CONFLICT(user_id) DO UPDATE SET root_key_id = ?2, iv = ?3, secret_ct = ?4, created_at = ?5
       WHERE totp_credentials.confirmed_at IS NULL
       RETURNING user_id`,
    )
    .bind(userId, keyring.current.id, sealed.iv, sealed.ciphertext, now)
    .first<{ user_id: string }>();
  return row ? secret : null;
}

async function checkAndRecord(
  db: D1Database,
  keyring: RootKeyring,
  userId: string,
  code: string,
  now: number,
  confirmed: boolean,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT root_key_id, iv, secret_ct FROM totp_credentials
       WHERE user_id = ? AND confirmed_at IS ${confirmed ? "NOT NULL" : "NULL"}`,
    )
    .bind(userId)
    .first<Row>();
  if (!row) return false;
  const secret = await openSecret(keyring, userId, row);
  try {
    const step = await matchTotp(secret, code, now);
    if (step === null) return false;
    const updated = await db
      .prepare(
        `UPDATE totp_credentials
         SET last_step = ?1, confirmed_at = COALESCE(confirmed_at, ?2)
         WHERE user_id = ?3 AND confirmed_at IS ${confirmed ? "NOT NULL" : "NULL"}
           AND (last_step IS NULL OR last_step < ?1)
         RETURNING user_id`,
      )
      .bind(step, now, userId)
      .first<{ user_id: string }>();
    return updated !== null;
  } finally {
    secret.fill(0);
  }
}

/** Confirms a pending secret with a correct code. */
export function confirmTotp(
  db: D1Database,
  keyring: RootKeyring,
  userId: string,
  code: string,
  now: number,
): Promise<boolean> {
  return checkAndRecord(db, keyring, userId, code, now, false);
}

/** Checks a code against the confirmed secret and records its step (single use). */
export function consumeTotpCode(
  db: D1Database,
  keyring: RootKeyring,
  userId: string,
  code: string,
  now: number,
): Promise<boolean> {
  return checkAndRecord(db, keyring, userId, code, now, true);
}

export async function hasConfirmedTotp(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS one FROM totp_credentials WHERE user_id = ? AND confirmed_at IS NOT NULL")
    .bind(userId)
    .first();
  return row !== null;
}

export async function deleteTotp(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare("DELETE FROM totp_credentials WHERE user_id = ? RETURNING user_id")
    .bind(userId)
    .first();
  return row !== null;
}

/**
 * Re-seals every TOTP secret not under the current root key, 100 rows at a time (root-key
 * rotation). Updates are conditional on the old root key id, like rewrapAllKeks.
 */
export async function rewrapTotpSecrets(db: D1Database, keyring: RootKeyring): Promise<number> {
  let count = 0;
  for (;;) {
    const { results } = await db
      .prepare(
        `SELECT user_id, root_key_id, iv, secret_ct FROM totp_credentials
         WHERE root_key_id != ? ORDER BY user_id LIMIT 100`,
      )
      .bind(keyring.current.id)
      .all<Row & { user_id: string }>();
    if (results.length === 0) return count;
    const updates: D1PreparedStatement[] = [];
    for (const row of results) {
      const secret = await openSecret(keyring, row.user_id, row);
      const sealed = await seal(keyring.current.key, secret, totpAad(row.user_id));
      secret.fill(0);
      updates.push(
        db
          .prepare(
            `UPDATE totp_credentials SET root_key_id = ?, iv = ?, secret_ct = ?
             WHERE user_id = ? AND root_key_id = ?`,
          )
          .bind(keyring.current.id, sealed.iv, sealed.ciphertext, row.user_id, row.root_key_id),
      );
    }
    const written = await db.batch(updates);
    const changed = written.reduce((n, r) => n + r.meta.changes, 0);
    count += changed;
    if (changed === 0 && results.length < 100) return count;
  }
}

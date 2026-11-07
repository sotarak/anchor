import { USER_CODE_ALPHABET } from "@anchor/shared";
import { isUniqueViolation } from "../lib/d1";
import { ApiError } from "../lib/errors";
import { newToken, randomBytes, sha256Hex } from "../lib/random";

/**
 * Browser login for the CLI (spec 2026-11-07-v0.4.0-cli-browser-login), modeled on RFC 8628:
 * the CLI holds a secret device code and polls; a signed-in web session approves the short user
 * code. Only sha256(deviceCode) is stored, so the table alone cannot collect a token.
 */
export const CLI_LOGIN_TTL_MS = 600_000;
export const CLI_LOGIN_INTERVAL_S = 5;
export const MAX_PENDING_CLI_LOGINS = 50;
export const MAX_PENDING_CLI_LOGINS_PER_IP = 5;
const PURGE_AFTER_MS = 86_400_000;

export type CliLoginRow = {
  id: string;
  user_code: string;
  status: "pending" | "approved" | "denied" | "consumed";
  user_id: string | null;
  client_name: string | null;
  user_agent: string | null;
  ip: string | null;
  created_at: number;
  expires_at: number;
  last_polled_at: number | null;
};

const NOT_FOUND = "This login request expired or does not exist";

/** `XXXX-XXXX` from the 20-letter alphabet, uniform by rejection sampling (240 = 12 * 20). */
export function newUserCode(): string {
  let letters = "";
  while (letters.length < 8) {
    for (const byte of randomBytes(16)) {
      if (byte >= 240 || letters.length === 8) continue;
      letters += USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length];
    }
  }
  return `${letters.slice(0, 4)}-${letters.slice(4)}`;
}

export async function startCliLogin(
  db: D1Database,
  i: { clientName: string | null; userAgent: string | null; ip: string | null; now: number },
): Promise<{ deviceCode: string; userCode: string; expiresAt: number }> {
  // Caps what anonymous traffic can write: per address, so one client cannot use up the
  // instance-wide cap and lock everyone out of browser login, and overall. Approximate under
  // concurrency, enough for a flood cap.
  const pending = await db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(ip = ?2), 0) AS mine
       FROM cli_logins WHERE status = 'pending' AND expires_at > ?1`,
    )
    .bind(i.now, i.ip)
    .first<{ n: number; mine: number }>();
  if (
    (pending?.n ?? 0) >= MAX_PENDING_CLI_LOGINS ||
    (i.ip !== null && (pending?.mine ?? 0) >= MAX_PENDING_CLI_LOGINS_PER_IP)
  ) {
    throw new ApiError(429, "rate_limited", "Too many pending CLI logins, try again later");
  }
  const deviceCode = newToken("anc_dc");
  const id = await sha256Hex(deviceCode);
  const expiresAt = i.now + CLI_LOGIN_TTL_MS;
  for (let attempt = 0; ; attempt++) {
    const userCode = newUserCode();
    try {
      await db
        .prepare(
          `INSERT INTO cli_logins (id, user_code, status, client_name, user_agent, ip, created_at, expires_at)
           VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)`,
        )
        .bind(id, userCode, i.clientName, i.userAgent, i.ip, i.now, expiresAt)
        .run();
      return { deviceCode, userCode, expiresAt };
    } catch (err) {
      // A user code collision: draw once more.
      if (attempt === 0 && isUniqueViolation(err)) continue;
      throw err;
    }
  }
}

/**
 * One poll. The poll stamp and the interval check are one UPDATE, so concurrent polls cannot
 * both pass; the approved -> consumed UPDATE decides the single winner that gets a session.
 */
export async function exchangeCliLogin(
  db: D1Database,
  deviceCode: string,
  now: number,
): Promise<
  { status: "pending" } | { status: "approved"; userId: string; userAgent: string | null }
> {
  const id = await sha256Hex(deviceCode);
  const stamped = await db
    .prepare(
      `UPDATE cli_logins SET last_polled_at = ?
       WHERE id = ? AND expires_at > ? AND status != 'consumed'
         AND (last_polled_at IS NULL OR last_polled_at <= ?)`,
    )
    .bind(now, id, now, now - CLI_LOGIN_INTERVAL_S * 1000)
    .run();
  const row = await db
    .prepare("SELECT * FROM cli_logins WHERE id = ?")
    .bind(id)
    .first<CliLoginRow>();
  if (!row || row.expires_at <= now || row.status === "consumed") {
    throw new ApiError(404, "not_found", NOT_FOUND);
  }
  if (stamped.meta.changes === 0) {
    throw new ApiError(
      429,
      "rate_limited",
      `Polling too fast; wait ${CLI_LOGIN_INTERVAL_S} seconds between requests`,
    );
  }
  if (row.status === "pending") return { status: "pending" };
  if (row.status === "denied") throw new ApiError(403, "forbidden", "This login was denied");
  const won = await db
    .prepare("UPDATE cli_logins SET status = 'consumed' WHERE id = ? AND status = 'approved'")
    .bind(id)
    .run();
  if (won.meta.changes !== 1 || !row.user_id) throw new ApiError(404, "not_found", NOT_FOUND);
  return { status: "approved", userId: row.user_id, userAgent: row.user_agent };
}

/** A request the dashboard may show and decide: pending and unexpired. */
export function findPendingCliLogin(
  db: D1Database,
  userCode: string,
  now: number,
): Promise<CliLoginRow | null> {
  return db
    .prepare(
      "SELECT * FROM cli_logins WHERE user_code = ? AND status = 'pending' AND expires_at > ?",
    )
    .bind(userCode, now)
    .first<CliLoginRow>();
}

/** Approves or denies a pending request. False when it is no longer pending (or expired). */
export async function decideCliLogin(
  db: D1Database,
  userCode: string,
  decision: "approved" | "denied",
  userId: string,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE cli_logins SET status = ?, user_id = ?
       WHERE user_code = ? AND status = 'pending' AND expires_at > ?`,
    )
    .bind(decision, userId, userCode, now)
    .run();
  return result.meta.changes === 1;
}

/** Daily cron: rows expired for more than a day are gone. */
export async function purgeCliLogins(db: D1Database, now: number): Promise<number> {
  const result = await db
    .prepare("DELETE FROM cli_logins WHERE expires_at < ?")
    .bind(now - PURGE_AFTER_MS)
    .run();
  return result.meta.changes;
}

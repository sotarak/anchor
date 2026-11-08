import { rateLimitKey } from "../lib/ip";

/**
 * Password login limits (spec 2026-11-09-v0.5.3). Failures are counted per (client address,
 * submitted email) and per address, never per account: someone hammering an email from their
 * own address locks only themselves, and the real user logs in from anywhere else. Unknown
 * emails count exactly like known ones, so a 429 reveals nothing about which accounts exist.
 */
export const LOGIN_PAIR_MAX_FAILURES = 5;
export const LOGIN_ADDRESS_MAX_FAILURES = 50;
export const LOGIN_WINDOW_MS = 900_000;
const PURGE_AFTER_MS = 86_400_000;

export type LoginKey = { key: string; max: number };

/** The counters one attempt touches. IPv6 counts by /64; no address key without an address. */
export function loginAttemptKeys(clientIp: string | null, email: string): LoginKey[] {
  const addr = rateLimitKey(clientIp);
  const pair: LoginKey = { key: `p|${addr ?? "-"}|${email}`, max: LOGIN_PAIR_MAX_FAILURES };
  if (addr === null) return [pair];
  return [pair, { key: `i|${addr}`, max: LOGIN_ADDRESS_MAX_FAILURES }];
}

const pairEmail = (key: string): string | null =>
  key.startsWith("p|") ? key.slice(key.indexOf("|", 2) + 1) : null;

/**
 * Counts one attempt against every key, atomically per key, before the password is checked.
 * Returns false when any key is locked (a locked key is not counted). Per key: the count restarts
 * at 1 when the window has passed or a lock has ended; the attempt that reaches `max` still
 * proceeds and sets the lock for LOGIN_WINDOW_MS (as the 0.5.2 account lock did).
 */
export async function reserveLoginKeys(
  db: D1Database,
  keys: LoginKey[],
  now: number,
): Promise<boolean> {
  const windowStart = now - LOGIN_WINDOW_MS;
  const lockUntil = now + LOGIN_WINDOW_MS;
  // ?1 key, ?2 email, ?3 max, ?4 now, ?5 now - window, ?6 now + window
  const restart = "(login_attempts.locked_until IS NOT NULL OR login_attempts.window_start <= ?5)";
  const next = `(CASE WHEN ${restart} THEN 1 ELSE login_attempts.failures + 1 END)`;
  const stmt = db.prepare(
    `INSERT INTO login_attempts (key, email, failures, window_start, locked_until)
     VALUES (?1, ?2, CASE WHEN 1 >= ?3 THEN 0 ELSE 1 END, ?4, CASE WHEN 1 >= ?3 THEN ?6 ELSE NULL END)
     ON CONFLICT(key) DO UPDATE SET
       failures = CASE WHEN ${next} >= ?3 THEN 0 ELSE ${next} END,
       window_start = CASE WHEN ${restart} THEN ?4 ELSE login_attempts.window_start END,
       locked_until = CASE WHEN ${next} >= ?3 THEN ?6 ELSE NULL END
     WHERE login_attempts.locked_until IS NULL OR login_attempts.locked_until <= ?4
     RETURNING key`,
  );
  const results = await db.batch<{ key: string }>(
    keys.map((k) => stmt.bind(k.key, pairEmail(k.key), k.max, now, windowStart, lockUntil)),
  );
  return results.every((r) => r.results.length === 1);
}

/** A successful login clears its own pair; the address counter keeps counting. */
export async function clearLoginPair(
  db: D1Database,
  clientIp: string | null,
  email: string,
): Promise<void> {
  const [pair] = loginAttemptKeys(clientIp, email);
  if (pair) await db.prepare("DELETE FROM login_attempts WHERE key = ?").bind(pair.key).run();
}

/** A password reset lifts every lock on the email, from every address. */
export async function clearLoginLocksForEmail(db: D1Database, email: string): Promise<void> {
  await db.prepare("DELETE FROM login_attempts WHERE email = ?").bind(email).run();
}

/** Daily cron: windows older than a day whose lock (if any) has ended. */
export async function purgeLoginAttempts(db: D1Database, now: number): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM login_attempts
       WHERE window_start < ? AND (locked_until IS NULL OR locked_until <= ?)`,
    )
    .bind(now - PURGE_AFTER_MS, now)
    .run();
  return result.meta.changes;
}

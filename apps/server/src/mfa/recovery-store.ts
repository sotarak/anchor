import { newId } from "../lib/random";
import { generateRecoveryCodes, hashRecoveryCode, normalizeRecoveryCode } from "./recovery-codes";

/** Replaces the user's codes with a fresh set and returns them (shown once, never stored). */
export async function replaceRecoveryCodes(
  db: D1Database,
  userId: string,
  now: number,
): Promise<string[]> {
  const codes = generateRecoveryCodes();
  const inserts = await Promise.all(
    codes.map(async (code) =>
      db
        .prepare(
          "INSERT INTO recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind(
          newId(),
          userId,
          await hashRecoveryCode(userId, normalizeRecoveryCode(code) ?? ""),
          now,
        ),
    ),
  );
  await db.batch([
    db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").bind(userId),
    ...inserts,
  ]);
  return codes;
}

/** Uses one code (typed loosely); false for unknown, used or malformed codes. */
export async function consumeRecoveryCode(
  db: D1Database,
  userId: string,
  input: string,
  now: number,
): Promise<boolean> {
  const normalized = normalizeRecoveryCode(input);
  if (!normalized) return false;
  const row = await db
    .prepare(
      `UPDATE recovery_codes SET used_at = ?
       WHERE user_id = ? AND code_hash = ? AND used_at IS NULL RETURNING id`,
    )
    .bind(now, userId, await hashRecoveryCode(userId, normalized))
    .first();
  return row !== null;
}

/** Unused codes left. */
export async function countRecoveryCodes(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL")
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function deleteRecoveryCodes(db: D1Database, userId: string): Promise<void> {
  await db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").bind(userId).run();
}

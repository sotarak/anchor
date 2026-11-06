import { newId, newToken, sha256Hex, tokenPrefix } from "../lib/random";

export const PASSWORD_RESET_TTL_MS = 3_600_000; // 1 h
const TOKEN_PREFIX = "anc_rst_";

/**
 * The link's creator could still create it now: active, and an owner, or an admin resetting a
 * member. Checked at use time, so a target promoted after the link was made (admin → owner
 * takeover) or a creator disabled, demoted or deleted since, leaves the link dead.
 */
const CREATOR_STILL_AUTHORIZED = `EXISTS (SELECT 1 FROM users creator
  WHERE creator.id = password_resets.created_by AND creator.disabled_at IS NULL
    AND (creator.role = 'owner' OR (creator.role = 'admin'
      AND (SELECT target.role FROM users target WHERE target.id = password_resets.user_id) = 'member')))`;

/** Creates a reset link; every earlier unused link of the user stops working (only the newest does). */
export async function createPasswordReset(
  db: D1Database,
  userId: string,
  createdBy: string,
  now: number,
): Promise<{ token: string; expiresAt: number }> {
  const token = newToken("anc_rst");
  const expiresAt = now + PASSWORD_RESET_TTL_MS;
  await db.batch([
    db
      .prepare("UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL")
      .bind(now, userId),
    db
      .prepare(
        `INSERT INTO password_resets (id, user_id, token_hash, token_prefix, created_by, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(newId(), userId, await sha256Hex(token), tokenPrefix(token), createdBy, now, expiresAt),
  ]);
  return { token, expiresAt };
}

/**
 * Sets the new password and consumes the link in one batch (one transaction). Both statements
 * require a live link and an enabled user, so a link outlives neither use, expiry nor disabling.
 * Also clears lockout. Returns the user id, or null when the link is unusable.
 */
export async function consumePasswordReset(
  db: D1Database,
  token: string,
  passwordHash: string,
  now: number,
): Promise<string | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const tokenHash = await sha256Hex(token);
  const [setPassword, markUsed] = await db.batch<{ id: string }>([
    db
      .prepare(
        `UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL, updated_at = ?
         WHERE id = (SELECT user_id FROM password_resets
                     WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
                       AND ${CREATOR_STILL_AUTHORIZED})
           AND disabled_at IS NULL
         RETURNING id`,
      )
      .bind(passwordHash, now, tokenHash, now),
    db
      .prepare(
        `UPDATE password_resets SET used_at = ?
         WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
           AND user_id IN (SELECT id FROM users WHERE disabled_at IS NULL)
           AND ${CREATOR_STILL_AUTHORIZED}`,
      )
      .bind(now, tokenHash, now),
  ]);
  const userId = setPassword?.results[0]?.id;
  return userId && markUsed?.meta.changes === 1 ? userId : null;
}

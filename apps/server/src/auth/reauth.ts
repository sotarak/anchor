import type { Context } from "hono";
import type { AppEnv, UserPrincipal } from "../env";
import { ApiError } from "../lib/errors";
import { requireWebUser } from "./middleware";
import { REAUTH_WINDOW_MS } from "./reauth-window";

export { REAUTH_WINDOW_MS };

/** When the session last proved the password or a factor (null for CLI sessions). */
export async function readReauthAt(db: D1Database, sessionId: string): Promise<number | null> {
  const row = await db
    .prepare("SELECT reauth_at FROM sessions WHERE id = ?")
    .bind(sessionId)
    .first<{ reauth_at: number | null }>();
  return row?.reauth_at ?? null;
}

/** Records a fresh proof on the session and returns until when it allows MFA changes. */
export async function markReauthenticated(
  db: D1Database,
  sessionId: string,
  now: number,
): Promise<number> {
  await db.prepare("UPDATE sessions SET reauth_at = ? WHERE id = ?").bind(now, sessionId).run();
  return now + REAUTH_WINDOW_MS;
}

/**
 * A dashboard session (cookie, `web`) that proved the password or a factor in the last
 * 10 minutes; otherwise 403 `reauth_required`. Guards every MFA change (spec 0.6.0, decision 4).
 */
export async function requireRecentReauth(c: Context<AppEnv>): Promise<UserPrincipal> {
  const principal = await requireWebUser(c, "Manage two-factor authentication from the dashboard");
  const reauthAt = await readReauthAt(c.env.DB, principal.sessionId);
  if (reauthAt === null || reauthAt <= Date.now() - REAUTH_WINDOW_MS) {
    throw new ApiError(403, "reauth_required", "Confirm it's you to continue");
  }
  return principal;
}

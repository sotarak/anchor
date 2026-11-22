import { env } from "cloudflare:workers";
import { api, jsonInit } from "./http";

/** Ages the user's sessions' step-up proof by `ms` (default: past the 10-minute window). */
export async function staleReauth(userId: string, ms = 11 * 60_000): Promise<void> {
  await env.DB.prepare("UPDATE sessions SET reauth_at = ? WHERE user_id = ?")
    .bind(Date.now() - ms, userId)
    .run();
}

/** A cookie request to an MFA endpoint (Origin set, so it passes the CSRF check). */
export function mfaCall(method: string, path: string, cookie: string, body?: unknown) {
  return api(`/api/v1${path}`, jsonInit(method, body, { cookie }));
}

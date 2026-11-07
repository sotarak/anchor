import { purgeCliLogins } from "../auth/cli-login";
import type { Bindings } from "../env";
import { sweepStaleRotations } from "../keys/queue";
import { log } from "../lib/log";
import { purgeOAuth } from "../oauth/store";
import { purgeAudit } from "./repo";

/**
 * Cron Trigger (daily): enforces audit retention, resumes KEK rotations whose queue message
 * was lost, and deletes old CLI login requests and expired OAuth codes, tokens and clients. The jobs are independent: one failing does not
 * skip the others.
 */
export async function handleScheduled(
  _controller: ScheduledController,
  env: Bindings,
  _ctx: ExecutionContext,
): Promise<void> {
  const now = Date.now();
  const [purge, sweep, logins, oauth] = await Promise.allSettled([
    purgeAudit(env.DB, now),
    sweepStaleRotations(env.DB, env.REENCRYPT_QUEUE, now),
    purgeCliLogins(env.DB, now),
    purgeOAuth(env.DB, now),
  ]);
  if (purge.status === "fulfilled") log("info", "audit_purged", { count: purge.value });
  if (sweep.status === "fulfilled") log("info", "rotations_swept", { count: sweep.value });
  if (logins.status === "fulfilled") log("info", "cli_logins_purged", { count: logins.value });
  if (oauth.status === "fulfilled") log("info", "oauth_purged", { count: oauth.value });
  for (const r of [purge, sweep, logins, oauth]) if (r.status === "rejected") throw r.reason;
}

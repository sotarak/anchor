import type { Bindings } from "../env";
import { sweepStaleRotations } from "../keys/queue";
import { log } from "../lib/log";
import { purgeAudit } from "./repo";

/**
 * Cron Trigger (daily): enforces audit retention and resumes KEK rotations whose queue message
 * was lost. The two jobs are independent: one failing does not skip the other.
 */
export async function handleScheduled(
  _controller: ScheduledController,
  env: Bindings,
  _ctx: ExecutionContext,
): Promise<void> {
  const now = Date.now();
  const [purge, sweep] = await Promise.allSettled([
    purgeAudit(env.DB, now),
    sweepStaleRotations(env.DB, env.REENCRYPT_QUEUE, now),
  ]);
  if (purge.status === "fulfilled") log("info", "audit_purged", { count: purge.value });
  if (sweep.status === "fulfilled") log("info", "rotations_swept", { count: sweep.value });
  for (const r of [purge, sweep]) if (r.status === "rejected") throw r.reason;
}

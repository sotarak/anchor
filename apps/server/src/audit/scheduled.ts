import type { Bindings } from "../env";
import { log } from "../lib/log";
import { purgeAudit } from "./repo";

/** Cron Trigger (daily): enforces audit retention. */
export async function handleScheduled(
  _controller: ScheduledController,
  env: Bindings,
  _ctx: ExecutionContext,
): Promise<void> {
  const count = await purgeAudit(env.DB, Date.now());
  log("info", "audit_purged", { count });
}

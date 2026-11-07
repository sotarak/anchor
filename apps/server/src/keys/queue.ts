import { getRootKeyring } from "../crypto/keyring";
import type { Bindings } from "../env";
import { log } from "../lib/log";
import { processRotationBatch, type ReencryptMessage } from "./rotation";

/**
 * The root wrangler.jsonc sets max_retries 10 for anchor-reencrypt. The 10th failing attempt marks
 * the rotation failed and acks: a rotation must not stay "running" forever while its message cycles
 * through the dead letter queue and the daily sweep (whether the platform delivers 10 or 11 times).
 */
export const REENCRYPT_MAX_ATTEMPTS = 10;

/**
 * Delay before redelivering a failed batch: 30 s, doubling, capped at an hour. The ten attempts
 * then span about three hours, so a short D1 or platform outage does not fail the rotation.
 */
export function retryDelaySeconds(attempts: number): number {
  return Math.min(30 * 2 ** (attempts - 1), 3600);
}

/** A running rotation untouched for this long is assumed to have lost its message. */
export const STALE_ROTATION_MS = 15 * 60_000;

function isReencryptMessage(body: unknown): body is ReencryptMessage {
  const m = body as Partial<ReencryptMessage> | null;
  return (
    !!m &&
    m.type === "reencrypt" &&
    typeof m.rotationId === "string" &&
    typeof m.projectId === "string" &&
    typeof m.toVersion === "number"
  );
}

/**
 * Consumer for anchor-reencrypt (max_batch_size 1). Each message re-encrypts one batch: "more"
 * sends the next message before acking, "done"/"failed" ack, and a thrown error retries until
 * REENCRYPT_MAX_ATTEMPTS (with backoff), where the rotation is marked failed ("retries_exhausted") and acked.
 */
export async function handleReencryptBatch(
  batch: MessageBatch<unknown>,
  env: Bindings,
): Promise<void> {
  for (const msg of batch.messages) {
    if (!isReencryptMessage(msg.body)) {
      log("warn", "reencrypt_message_dropped", { id: msg.id });
      msg.ack();
      continue;
    }
    try {
      const keyring = await getRootKeyring(env);
      const outcome = await processRotationBatch(env.DB, keyring, msg.body, Date.now());
      if (outcome === "more") await env.REENCRYPT_QUEUE.send(msg.body);
      msg.ack();
    } catch (err) {
      log("error", "reencrypt_batch_failed", {
        rotationId: msg.body.rotationId,
        attempts: msg.attempts,
        name: err instanceof Error ? err.name : "unknown",
      });
      if (msg.attempts < REENCRYPT_MAX_ATTEMPTS) {
        msg.retry({ delaySeconds: retryDelaySeconds(msg.attempts) });
        continue;
      }
      // If this write fails too, the platform redelivers (the message is not acked).
      await env.DB.prepare(
        "UPDATE key_rotations SET status = 'failed', error = 'retries_exhausted', updated_at = ? WHERE id = ? AND status = 'running'",
      )
        .bind(Date.now(), msg.body.rotationId)
        .run();
      log("error", "reencrypt_rotation_failed", {
        rotationId: msg.body.rotationId,
        error: "retries_exhausted",
      });
      msg.ack();
    }
  }
}

/** Re-sends the message of every running rotation idle for STALE_ROTATION_MS. */
export async function sweepStaleRotations(
  db: D1Database,
  queue: Queue<ReencryptMessage>,
  now: number,
): Promise<number> {
  const { results } = await db
    .prepare(
      "SELECT id, project_id, to_version FROM key_rotations WHERE status = 'running' AND updated_at < ?",
    )
    .bind(now - STALE_ROTATION_MS)
    .all<{ id: string; project_id: string; to_version: number }>();
  for (const r of results) {
    await queue.send({
      type: "reencrypt",
      rotationId: r.id,
      projectId: r.project_id,
      toVersion: r.to_version,
    });
  }
  return results.length;
}

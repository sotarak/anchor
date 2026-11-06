import type { AuditAction } from "@anchor/shared";
import type { Context } from "hono";
import type { AppEnv, Principal } from "../env";
import { newId } from "../lib/random";

export type AuditActor = {
  type: "user" | "service_token" | "anonymous";
  id: string | null;
  label: string | null;
};

export type AuditInput = {
  action: AuditAction;
  actor?: AuditActor;
  projectId?: string | null;
  environmentId?: string | null;
  target?: string | null;
  metadata?: Record<string, unknown>;
};

const FORBIDDEN_KEY =
  /^(value|values|rawValue|password|currentPassword|newPassword|token|cookie|authorization)$/i;
const MAX_METADATA_BYTES = 16_384;
const MAX_KEYS = 500;

export function actorOf(principal: Principal | undefined): AuditActor {
  if (!principal) return { type: "anonymous", id: null, label: null };
  if (principal.type === "service_token") {
    return { type: "service_token", id: principal.tokenId, label: principal.name };
  }
  return { type: "user", id: principal.userId, label: principal.email };
}

/** Throws when any object key, at any depth, could carry a secret value or credential. */
function assertNoForbiddenKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenKeys(item);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error(`audit metadata contains forbidden field: ${key}`);
    assertNoForbiddenKeys(child);
  }
}

/** Byte budget for the key names, leaving room under MAX_METADATA_BYTES for path and framing. */
const MAX_KEYS_BYTES = 12_288;

/**
 * Key lists for secret.read: at most 500 names and at most MAX_KEYS_BYTES of JSON, flagged when
 * more existed. Without the byte cap, a large folder of long key names would overflow the
 * metadata limit and every reveal of it would fail closed with a 500.
 */
export function capKeys(keys: string[]): { keys: string[]; keysTruncated?: true } {
  const kept: string[] = [];
  let bytes = 2; // []
  for (const key of keys) {
    const size = new TextEncoder().encode(JSON.stringify(key)).byteLength + 1; // name + comma
    if (kept.length === MAX_KEYS || bytes + size > MAX_KEYS_BYTES) {
      return { keys: kept, keysTruncated: true };
    }
    kept.push(key);
    bytes += size;
  }
  return { keys: kept };
}

/**
 * Appends one audit row and waits for it. Callers record after the action succeeds and before
 * responding, so a failed audit write fails the request (no unaudited secret reads).
 */
export async function recordAudit(c: Context<AppEnv>, input: AuditInput): Promise<void> {
  const metadata = input.metadata ?? {};
  assertNoForbiddenKeys(metadata);
  const serialized = JSON.stringify(metadata);
  if (new TextEncoder().encode(serialized).byteLength > MAX_METADATA_BYTES) {
    throw new Error("audit metadata too large");
  }
  const actor = input.actor ?? actorOf(c.get("principal"));
  await c.env.DB.prepare(
    `INSERT INTO audit_events (id, at, actor_type, actor_id, actor_label, action, project_id,
       environment_id, target, ip, user_agent, request_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      newId(),
      Date.now(),
      actor.type,
      actor.id,
      actor.label,
      input.action,
      input.projectId ?? null,
      input.environmentId ?? null,
      input.target ?? null,
      c.get("clientIp") ?? null,
      c.get("userAgent") ?? null,
      c.get("requestId") ?? null,
      serialized,
    )
    .run();
}

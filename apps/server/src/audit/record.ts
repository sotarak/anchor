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

/** Byte budgets inside MAX_METADATA_BYTES, leaving room for the path and framing. */
const MAX_KEYS_BYTES = 10_240;
const MAX_REFERENCED_BYTES = 3_072;
const MAX_IMPORTS_BYTES = 1_024;

/** Keeps leading items while their JSON stays within `maxBytes` and `maxItems`. */
function capList<T>(items: T[], maxBytes: number, maxItems = Number.POSITIVE_INFINITY) {
  const kept: T[] = [];
  let bytes = 2; // []
  for (const item of items) {
    const size = new TextEncoder().encode(JSON.stringify(item)).byteLength + 1; // item + comma
    if (kept.length === maxItems || bytes + size > maxBytes) return { kept, truncated: true };
    kept.push(item);
    bytes += size;
  }
  return { kept, truncated: false };
}

/**
 * Key lists for secret.read: at most 500 names and at most MAX_KEYS_BYTES of JSON, flagged when
 * more existed. Without the byte cap, a large folder of long key names would overflow the
 * metadata limit and every reveal of it would fail closed with a 500.
 */
export function capKeys(keys: string[]): { keys: string[]; keysTruncated?: true } {
  const { kept, truncated } = capList(keys, MAX_KEYS_BYTES, MAX_KEYS);
  return truncated ? { keys: kept, keysTruncated: true } : { keys: kept };
}

/**
 * secret.read extras (M5): the secrets references were expanded from and the imports read.
 * Omitted when empty; capped by bytes like the key list.
 */
export function readSources(
  referenced: { environment: string; path: string; key: string }[],
  imports: { environment: string; path: string }[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (referenced.length > 0) {
    const r = capList(referenced, MAX_REFERENCED_BYTES);
    out.referenced = r.kept;
    if (r.truncated) out.referencedTruncated = true;
  }
  if (imports.length > 0) {
    const i = capList(imports, MAX_IMPORTS_BYTES);
    out.imports = i.kept;
    if (i.truncated) out.importsTruncated = true;
  }
  return out;
}

/** Validates and serializes audit metadata (no forbidden keys, within the size cap). */
function serializeMetadata(input: AuditInput): string {
  const metadata = input.metadata ?? {};
  assertNoForbiddenKeys(metadata);
  const serialized = JSON.stringify(metadata);
  if (new TextEncoder().encode(serialized).byteLength > MAX_METADATA_BYTES) {
    throw new Error("audit metadata too large");
  }
  return serialized;
}

/**
 * Appends one audit row and waits for it. Callers record after the action succeeds and before
 * responding, so a failed audit write fails the request (no unaudited secret reads).
 */
export async function recordAudit(c: Context<AppEnv>, input: AuditInput): Promise<void> {
  await insertAudit(c.env.DB, input, serializeMetadata(input), {
    actor: input.actor ?? actorOf(c.get("principal")),
    ip: c.get("clientIp") ?? null,
    userAgent: c.get("userAgent") ?? null,
    requestId: c.get("requestId") ?? null,
  });
}

/** Actor for work no request drives (queue consumers, cron). */
export const SYSTEM_ACTOR: AuditActor = { type: "anonymous", id: null, label: "system" };

const SYSTEM_ORIGIN = { ip: null, userAgent: null, requestId: null };

/**
 * A system audit insert to run inside the caller's db.batch, so the event commits or rolls back
 * with the change it records. It inserts only while `when` (an SQL condition) holds.
 */
export function systemAuditStatement(
  db: D1Database,
  input: AuditInput,
  when: { sql: string; params: unknown[] },
): D1PreparedStatement {
  return auditStatement(
    db,
    input,
    serializeMetadata(input),
    { actor: input.actor ?? SYSTEM_ACTOR, ...SYSTEM_ORIGIN },
    when,
  );
}

type AuditOrigin = {
  actor: AuditActor;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
};

function auditStatement(
  db: D1Database,
  input: AuditInput,
  serialized: string,
  origin: AuditOrigin,
  when?: { sql: string; params: unknown[] },
): D1PreparedStatement {
  const { actor } = origin;
  return db
    .prepare(
      `INSERT INTO audit_events (id, at, actor_type, actor_id, actor_label, action, project_id,
       environment_id, target, ip, user_agent, request_id, metadata)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${when ? ` WHERE ${when.sql}` : ""}`,
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
      origin.ip,
      origin.userAgent,
      origin.requestId,
      serialized,
      ...(when?.params ?? []),
    );
}

async function insertAudit(
  db: D1Database,
  input: AuditInput,
  serialized: string,
  origin: AuditOrigin,
): Promise<void> {
  await auditStatement(db, input, serialized, origin).run();
}

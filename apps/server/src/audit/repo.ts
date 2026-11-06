import type { AuditAction, AuditEventDto } from "@anchor/shared";
import { fromBase64Url, toBase64Url, utf8Decode, utf8Encode } from "../lib/encoding";
import { ApiError } from "../lib/errors";

export const AUDIT_RETENTION_MS = 31_536_000_000; // 365 days

type AuditEventRow = {
  id: string;
  at: number;
  actor_type: AuditEventDto["actor"]["type"];
  actor_id: string | null;
  actor_label: string | null;
  action: AuditAction;
  project_id: string | null;
  environment_id: string | null;
  target: string | null;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  metadata: string;
};

const CURSOR = /^(0|[1-9]\d{0,15}):([A-Za-z0-9_-]{1,64})$/;

export function encodeCursor(at: number, id: string): string {
  return toBase64Url(utf8Encode(`${at}:${id}`));
}

/** Parses a cursor from encodeCursor; anything else is a 400, never a query on garbage. */
export function decodeCursor(s: string): { at: number; id: string } {
  const invalid = () => new ApiError(400, "bad_request", "invalid cursor");
  let text: string;
  try {
    text = utf8Decode(fromBase64Url(s));
  } catch {
    throw invalid();
  }
  const match = CURSOR.exec(text);
  const at = Number(match?.[1]);
  if (!match?.[2] || !Number.isSafeInteger(at)) throw invalid();
  return { at, id: match[2] };
}

function toAuditEventDto(r: AuditEventRow): AuditEventDto {
  return {
    id: r.id,
    at: r.at,
    actor: { type: r.actor_type, id: r.actor_id, label: r.actor_label },
    action: r.action,
    projectId: r.project_id,
    environmentId: r.environment_id,
    target: r.target,
    ip: r.ip,
    userAgent: r.user_agent,
    requestId: r.request_id,
    metadata: JSON.parse(r.metadata) as Record<string, unknown>,
  };
}

/** Newest first, keyset-paginated on (at, id): stable even when many events share a timestamp. */
export async function queryAudit(
  db: D1Database,
  filter: {
    projectId?: string;
    actorId?: string;
    action?: AuditAction;
    before?: string;
    limit: number;
  },
): Promise<{ events: AuditEventDto[]; nextCursor: string | null }> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (filter.projectId !== undefined) {
    where.push("project_id = ?");
    binds.push(filter.projectId);
  }
  if (filter.actorId !== undefined) {
    where.push("actor_id = ?");
    binds.push(filter.actorId);
  }
  if (filter.action !== undefined) {
    where.push("action = ?");
    binds.push(filter.action);
  }
  if (filter.before !== undefined) {
    const cursor = decodeCursor(filter.before);
    where.push("(at < ? OR (at = ? AND id < ?))");
    binds.push(cursor.at, cursor.at, cursor.id);
  }
  const sql = `SELECT * FROM audit_events ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY at DESC, id DESC LIMIT ?`;
  const { results } = await db
    .prepare(sql)
    .bind(...binds, filter.limit + 1)
    .all<AuditEventRow>();
  const rows = results.slice(0, filter.limit);
  const last = rows[rows.length - 1];
  return {
    events: rows.map(toAuditEventDto),
    nextCursor: results.length > filter.limit && last ? encodeCursor(last.at, last.id) : null,
  };
}

/**
 * Deletes rows older than the retention window. The cutoff is also bounded by D1's own clock
 * (the same expression the retention trigger uses), so a worker clock running ahead of D1 can
 * never select a row the trigger protects, which would abort the whole DELETE.
 */
export async function purgeAudit(db: D1Database, now: number): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM audit_events
       WHERE at < ?1 - ${AUDIT_RETENTION_MS}
         AND at <= CAST(strftime('%s','now') AS INTEGER) * 1000 - ${AUDIT_RETENTION_MS}`,
    )
    .bind(now)
    .run();
  return result.meta.changes;
}

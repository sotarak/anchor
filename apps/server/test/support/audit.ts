import { env } from "cloudflare:workers";
import type { AuditAction } from "@anchor/shared";

/**
 * The retention trigger from migrations/0002_access.sql, verbatim. resetDb drops and re-creates it
 * so tests can empty audit_events; keep this byte-identical to the migration.
 */
export const AUDIT_RETENTION_TRIGGER_DDL = `CREATE TRIGGER audit_events_retention BEFORE DELETE ON audit_events
WHEN old.at > (CAST(strftime('%s','now') AS INTEGER) * 1000 - 31536000000)
BEGIN SELECT RAISE(ABORT, 'audit_events within retention cannot be deleted'); END;`;

export type AuditRow = {
  id: string;
  at: number;
  actor_type: "user" | "service_token" | "anonymous";
  actor_id: string | null;
  actor_label: string | null;
  action: string;
  project_id: string | null;
  environment_id: string | null;
  target: string | null;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  metadata: string;
};

/** Audit rows, oldest first, optionally filtered by action. */
export async function auditRows(action?: AuditAction): Promise<AuditRow[]> {
  const stmt = action
    ? env.DB.prepare("SELECT * FROM audit_events WHERE action = ? ORDER BY at, id").bind(action)
    : env.DB.prepare("SELECT * FROM audit_events ORDER BY at, id");
  return (await stmt.all<AuditRow>()).results;
}

/**
 * A D1 binding whose audit inserts fail and everything else works, to prove routes fail closed:
 * createApp().request(path, init, { ...env, DB: failingAuditDb(env.DB) }).
 */
export function failingAuditDb(db: D1Database): D1Database {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "prepare") {
        return (sql: string) => {
          if (sql.includes("INSERT INTO audit_events")) throw new Error("audit unavailable");
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

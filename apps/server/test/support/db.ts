import { env } from "cloudflare:workers";
import { AUDIT_RETENTION_TRIGGER_DDL } from "./audit";

/**
 * Every application table, children before parents. A new migration that adds a table must add it
 * here; test/integration/db/reset.test.ts fails until it does.
 */
export const TABLES_CHILD_FIRST = [
  "audit_events",
  "key_rotations",
  "folder_imports",
  "folders",
  "service_tokens",
  "project_members",
  "password_resets",
  "invites",
  "secret_versions",
  "secrets",
  "environments",
  "project_keys",
  "projects",
  "sessions",
  "users",
] as const;

/** Empties every table. Tests must not assume isolated storage between files. */
export async function resetDb(): Promise<void> {
  // The retention trigger forbids deleting young audit rows, so lift it for the reset only.
  await env.DB.batch([
    env.DB.prepare("DROP TRIGGER IF EXISTS audit_events_retention"),
    ...TABLES_CHILD_FIRST.map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
    env.DB.prepare(AUDIT_RETENTION_TRIGGER_DDL),
  ]);
}

/** Application tables as D1 sees them (excludes SQLite, D1 and migration bookkeeping tables). */
export async function listAppTables(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
       AND name NOT LIKE 'd1_%'
     ORDER BY name`,
  ).all<{ name: string }>();
  return results.map((r) => r.name);
}

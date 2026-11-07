import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "#test/support";

const db = env.DB;

const OLD_TABLE = `CREATE TABLE service_tokens (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (permission IN ('read','read-write')),
  scopes TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
)`;

const insert = (id: string, hash: string, expiresAt: number | null, revokedAt: number | null) =>
  db
    .prepare(
      `INSERT INTO service_tokens (id, project_id, name, token_hash, token_prefix, permission,
         scopes, created_by, created_at, expires_at, last_used_at, revoked_at)
       VALUES (?, 'p1', ?, ?, 'anc_st_abcde', 'read', '[]', 'u1', 10, ?, 20, ?)`,
    )
    .bind(id, `name-${id}`, hash, expiresAt, revokedAt)
    .run();

/** Re-runs 0007 against a table in its 0.3.x shape, so the test exercises the real migration. */
async function runMigration0007() {
  const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith("0007_"));
  if (!migration) throw new Error("migration 0007 not found");
  for (const query of migration.queries) await db.prepare(query).run();
}

beforeEach(async () => {
  await resetDb();
  const now = Date.now();
  await db
    .prepare(
      "INSERT INTO projects (id, slug, name, current_key_version, created_at, updated_at) VALUES ('p1', 'app', 'App', 1, ?, ?)",
    )
    .bind(now, now)
    .run();
});

describe("migration 0007", () => {
  it("keeps every existing row and makes expires_at nullable", async () => {
    await db.prepare("DROP TABLE service_tokens").run();
    await db.prepare(OLD_TABLE).run();
    await insert("t1", "h1", 1000, null);
    await insert("t2", "h2", 2000, 1500);
    const before = await db.prepare("SELECT * FROM service_tokens ORDER BY id").all();

    await runMigration0007();

    const after = await db.prepare("SELECT * FROM service_tokens ORDER BY id").all();
    expect(after.results).toEqual(before.results);
    await insert("t3", "h3", null, null);
    const row = await db.prepare("SELECT expires_at FROM service_tokens WHERE id = 't3'").first();
    expect(row).toEqual({ expires_at: null });
    const fk = await db.prepare("PRAGMA foreign_key_check").all();
    expect(fk.results).toEqual([]);
  });

  it("still enforces a unique token hash", async () => {
    await insert("t1", "same", null, null);
    await expect(insert("t2", "same", null, null)).rejects.toThrow();
  });

  it("still cascades a project delete", async () => {
    await insert("t1", "h1", null, null);
    await db.prepare("DELETE FROM projects WHERE id = 'p1'").run();
    const count = await db
      .prepare("SELECT COUNT(*) AS n FROM service_tokens")
      .first<{ n: number }>();
    expect(count?.n).toBe(0);
  });
});

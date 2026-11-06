import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { AUDIT_RETENTION_TRIGGER_DDL, resetDb } from "#test/support";

const db = env.DB;
const YEAR_MS = 31_536_000_000;

async function insertAudit(id: string, at: number, projectId: string | null = null) {
  await db
    .prepare(
      "INSERT INTO audit_events (id, at, actor_type, action, project_id) VALUES (?, ?, 'anonymous', 'auth.login', ?)",
    )
    .bind(id, at, projectId)
    .run();
}

async function insertProjectWithMemberAndToken() {
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at) VALUES ('u1', 'a@x.io', 'n', 'h', 'member', ?, ?)",
      )
      .bind(now, now),
    db
      .prepare(
        "INSERT INTO projects (id, slug, name, current_key_version, created_at, updated_at) VALUES ('p1', 'app', 'App', 1, ?, ?)",
      )
      .bind(now, now),
    db
      .prepare(
        "INSERT INTO project_members (project_id, user_id, role, environment_ids, created_at, updated_at) VALUES ('p1', 'u1', 'viewer', NULL, ?, ?)",
      )
      .bind(now, now),
    db
      .prepare(
        "INSERT INTO service_tokens (id, project_id, name, token_hash, token_prefix, permission, scopes, created_at, expires_at) VALUES ('t1', 'p1', 'ci', 'h1', 'anc_st_xxxxx', 'read', '[]', ?, ?)",
      )
      .bind(now, now + 86_400_000),
  ]);
}

const count = async (table: string) =>
  (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())?.n;

beforeEach(resetDb);

describe("migration 0002", () => {
  it("audit_events rejects UPDATE", async () => {
    await insertAudit("a1", Date.now());
    await expect(
      db.prepare("UPDATE audit_events SET action = 'x' WHERE id = 'a1'").run(),
    ).rejects.toThrow(/append-only/);
  });

  it("audit_events rejects DELETE of a young row", async () => {
    await insertAudit("a1", Date.now());
    await expect(db.prepare("DELETE FROM audit_events WHERE id = 'a1'").run()).rejects.toThrow(
      /retention/,
    );
    expect(await count("audit_events")).toBe(1);
  });

  it("audit_events allows DELETE of a row older than 365 days", async () => {
    await insertAudit("old", Date.now() - YEAR_MS - 60_000);
    await db.prepare("DELETE FROM audit_events WHERE id = 'old'").run();
    expect(await count("audit_events")).toBe(0);
  });

  it("deleting a project keeps its audit rows", async () => {
    await insertProjectWithMemberAndToken();
    await insertAudit("a1", Date.now(), "p1");
    await db.prepare("DELETE FROM projects WHERE id = 'p1'").run();
    expect(await count("audit_events")).toBe(1);
  });

  it("deleting a project cascades members and service tokens", async () => {
    await insertProjectWithMemberAndToken();
    await db.prepare("DELETE FROM projects WHERE id = 'p1'").run();
    expect(await count("project_members")).toBe(0);
    expect(await count("service_tokens")).toBe(0);
  });

  it("users gain a nullable disabled_at column", async () => {
    await insertProjectWithMemberAndToken();
    const row = await db
      .prepare("SELECT disabled_at FROM users WHERE id = 'u1'")
      .first<{ disabled_at: number | null }>();
    expect(row).toEqual({ disabled_at: null });
  });

  it("project_members rejects unknown roles and service_tokens unknown permissions", async () => {
    await insertProjectWithMemberAndToken();
    const now = Date.now();
    await expect(
      db.prepare("UPDATE project_members SET role = 'owner' WHERE project_id = 'p1'").bind().run(),
    ).rejects.toThrow(/CHECK/);
    await expect(
      db
        .prepare(
          "INSERT INTO service_tokens (id, project_id, name, token_hash, token_prefix, permission, scopes, created_at, expires_at) VALUES ('t2', 'p1', 'ci', 'h2', 'p', 'write', '[]', ?, ?)",
        )
        .bind(now, now)
        .run(),
    ).rejects.toThrow(/CHECK/);
  });

  it("the test copy of the retention trigger matches the migration", () => {
    const squash = (sql: string) => sql.replace(/\s+/g, " ").replace(/;\s*$/, "").trim();
    const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith("0002"));
    const trigger = migration?.queries.find((q) => q.includes("audit_events_retention"));
    expect(trigger).toBeDefined();
    expect(squash(trigger ?? "")).toBe(squash(AUDIT_RETENTION_TRIGGER_DDL));
  });
});

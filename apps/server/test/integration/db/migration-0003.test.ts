import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { listAppTables, resetDb } from "#test/support";

const db = env.DB;

beforeEach(async () => {
  await resetDb();
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO projects (id, slug, name, current_key_version, created_at, updated_at) VALUES ('p1', 'app', 'App', 1, ?, ?)",
      )
      .bind(now, now),
    db
      .prepare(
        "INSERT INTO project_keys (project_id, version, root_key_id, iv, wrapped_key, created_at) VALUES ('p1', 1, 'rk1', x'00', x'00', ?)",
      )
      .bind(now),
    db
      .prepare(
        "INSERT INTO environments (id, project_id, slug, name, position, created_at) VALUES ('e1', 'p1', 'dev', 'Dev', 0, ?), ('e2', 'p1', 'prod', 'Prod', 1, ?)",
      )
      .bind(now, now),
  ]);
});

describe("migration 0003", () => {
  it("creates folders, folder_imports and key_rotations", async () => {
    const tables = await listAppTables();
    expect(tables).toEqual(expect.arrayContaining(["folders", "folder_imports", "key_rotations"]));
  });

  it("project_keys.status defaults to active and rejects unknown values", async () => {
    const row = await db
      .prepare("SELECT status FROM project_keys WHERE project_id = 'p1'")
      .first<{ status: string }>();
    expect(row?.status).toBe("active");
    await expect(
      db.prepare("UPDATE project_keys SET status = 'bogus' WHERE project_id = 'p1'").run(),
    ).rejects.toThrow();
  });

  it("deleting a source environment cascades its imports", async () => {
    await db
      .prepare(
        "INSERT INTO folder_imports (id, environment_id, path, source_environment_id, source_path, position, created_at) VALUES ('i1', 'e1', '/', 'e2', '/shared', 1, 0)",
      )
      .run();
    await db.prepare("DELETE FROM environments WHERE id = 'e2'").run();
    const { results } = await db.prepare("SELECT id FROM folder_imports").all();
    expect(results).toEqual([]);
  });

  it("folders are unique per environment and path", async () => {
    const insert = (id: string) =>
      db
        .prepare(
          "INSERT INTO folders (id, environment_id, path, created_at) VALUES (?, 'e1', '/api', 0)",
        )
        .bind(id)
        .run();
    await insert("f1");
    await expect(insert("f2")).rejects.toThrow();
  });

  it("key_rotations rejects an unknown status", async () => {
    await expect(
      db
        .prepare(
          "INSERT INTO key_rotations (id, project_id, from_version, to_version, status, total, done, started_at, updated_at) VALUES ('r1', 'p1', 1, 2, 'paused', 0, 0, 0, 0)",
        )
        .run(),
    ).rejects.toThrow();
  });
});

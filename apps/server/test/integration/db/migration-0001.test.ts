import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "#test/support";

const now = Date.now();
const db = env.DB;

async function insertUser(id: string, email: string) {
  await db
    .prepare(
      "INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at) VALUES (?, ?, 'n', 'h', 'owner', ?, ?)",
    )
    .bind(id, email, now, now)
    .run();
}

async function insertProjectTree() {
  await db.batch([
    db
      .prepare(
        "INSERT INTO projects (id, slug, name, current_key_version, created_at, updated_at) VALUES ('p1', 'app', 'App', 1, ?, ?)",
      )
      .bind(now, now),
    db
      .prepare(
        "INSERT INTO environments (id, project_id, slug, name, position, created_at) VALUES ('e1', 'p1', 'dev', 'Dev', 0, ?)",
      )
      .bind(now),
  ]);
}

async function insertSecret(id: string, key: string) {
  await db.batch([
    db
      .prepare(
        "INSERT INTO secrets (id, project_id, environment_id, path, key, current_version, created_at, updated_at) VALUES (?, 'p1', 'e1', '/', ?, 1, ?, ?)",
      )
      .bind(id, key, now, now),
    db
      .prepare(
        "INSERT INTO secret_versions (secret_id, version, alg, key_version, iv, ciphertext, created_at) VALUES (?, 1, 'A256GCM', 1, x'00', x'00', ?)",
      )
      .bind(id, now),
  ]);
}

beforeEach(resetDb);

describe("D1 schema", () => {
  it("email uniqueness is case-insensitive", async () => {
    await insertUser("u1", "a@x.io");
    await expect(insertUser("u2", "A@X.IO")).rejects.toThrow(/UNIQUE/);
  });

  it("secret keys are case-sensitive", async () => {
    await insertProjectTree();
    await insertSecret("s1", "DB_URL");
    await insertSecret("s2", "db_url");
    const row = await db.prepare("SELECT count(*) AS n FROM secrets").first<{ n: number }>();
    expect(row?.n).toBe(2);
  });

  it("deleting a project cascades", async () => {
    await insertProjectTree();
    await insertSecret("s1", "DB_URL");
    await db.prepare("DELETE FROM projects WHERE id = 'p1'").run();
    for (const table of ["environments", "secrets", "secret_versions"]) {
      const row = await db.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>();
      expect(row?.n, table).toBe(0);
    }
  });
});

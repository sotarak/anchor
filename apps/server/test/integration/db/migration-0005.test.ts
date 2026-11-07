import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "#test/support";

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
        "INSERT INTO environments (id, project_id, slug, name, position, created_at) VALUES ('e1', 'p1', 'dev', 'Dev', 0, ?)",
      )
      .bind(now),
    db
      .prepare(
        "INSERT INTO secrets (id, project_id, environment_id, path, key, current_version, created_at, updated_at) VALUES ('s1', 'p1', 'e1', '/', 'K', 1, ?, ?)",
      )
      .bind(now, now),
  ]);
});

const insertVersion = (version: number, extraCols = "", extraVals = "") =>
  db
    .prepare(
      `INSERT INTO secret_versions (secret_id, version, alg, key_version, iv, ciphertext, comment, created_at${extraCols}) VALUES ('s1', ${version}, 'AES-256-GCM', 1, x'00', x'00', '', 0${extraVals})`,
    )
    .run();

describe("migration 0005", () => {
  it("defaults a version row to string, sensitive, AAD format 1", async () => {
    await insertVersion(1);
    const row = await db
      .prepare(
        "SELECT value_type, sensitive, aad_format FROM secret_versions WHERE secret_id = 's1'",
      )
      .first();
    expect(row).toEqual({ value_type: "string", sensitive: 1, aad_format: 1 });
  });

  it.each([
    [", value_type", ", 'yaml'"],
    [", sensitive", ", 2"],
    [", aad_format", ", 3"],
  ])("rejects%s%s", async (cols, vals) => {
    await expect(insertVersion(1, cols, vals)).rejects.toThrow();
  });
});

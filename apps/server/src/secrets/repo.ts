import { toBytes } from "../lib/d1";

export type SecretRow = {
  id: string;
  project_id: string;
  environment_id: string;
  path: string;
  key: string;
  current_version: number;
  updated_at: number;
};

export type VersionRow = {
  secret_id: string;
  version: number;
  alg: string;
  key_version: number;
  iv: Uint8Array;
  ciphertext: Uint8Array;
  comment: string;
};

type RawVersionRow = Omit<VersionRow, "iv" | "ciphertext"> & { iv: unknown; ciphertext: unknown };

const SECRET_COLUMNS = "id, project_id, environment_id, path, key, current_version, updated_at";

function toVersionRow(r: RawVersionRow): VersionRow {
  return { ...r, iv: toBytes(r.iv), ciphertext: toBytes(r.ciphertext) };
}

export function findSecret(
  db: D1Database,
  environmentId: string,
  path: string,
  key: string,
): Promise<SecretRow | null> {
  return db
    .prepare(
      `SELECT ${SECRET_COLUMNS} FROM secrets WHERE environment_id = ? AND path = ? AND key = ?`,
    )
    .bind(environmentId, path, key)
    .first<SecretRow>();
}

export async function listSecretRows(
  db: D1Database,
  environmentId: string,
  path: string,
): Promise<SecretRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${SECRET_COLUMNS} FROM secrets WHERE environment_id = ? AND path = ? ORDER BY key`,
    )
    .bind(environmentId, path)
    .all<SecretRow>();
  return results;
}

export async function getVersion(
  db: D1Database,
  secretId: string,
  version: number,
): Promise<VersionRow | null> {
  const row = await db
    .prepare(
      "SELECT secret_id, version, alg, key_version, iv, ciphertext, comment FROM secret_versions WHERE secret_id = ? AND version = ?",
    )
    .bind(secretId, version)
    .first<RawVersionRow>();
  return row ? toVersionRow(row) : null;
}

/** Current version of every secret at exactly `path`, one query. */
export async function listCurrentVersions(
  db: D1Database,
  environmentId: string,
  path: string,
): Promise<Map<string, VersionRow>> {
  const { results } = await db
    .prepare(
      `SELECT v.secret_id, v.version, v.alg, v.key_version, v.iv, v.ciphertext, v.comment
       FROM secrets s JOIN secret_versions v ON v.secret_id = s.id AND v.version = s.current_version
       WHERE s.environment_id = ? AND s.path = ?`,
    )
    .bind(environmentId, path)
    .all<RawVersionRow>();
  return new Map(results.map((r) => [r.secret_id, toVersionRow(r)]));
}

export function insertSecretStatement(
  db: D1Database,
  s: SecretRow,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO secrets (id, project_id, environment_id, path, key, current_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(s.id, s.project_id, s.environment_id, s.path, s.key, s.current_version, now, now);
}

export function insertVersionStatement(
  db: D1Database,
  v: VersionRow,
  createdBy: string | null,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO secret_versions (secret_id, version, alg, key_version, iv, ciphertext, comment, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      v.secret_id,
      v.version,
      v.alg,
      v.key_version,
      v.iv,
      v.ciphertext,
      v.comment,
      createdBy,
      now,
    );
}

export function setCurrentVersionStatement(
  db: D1Database,
  secretId: string,
  version: number,
  now: number,
): D1PreparedStatement {
  return db
    .prepare("UPDATE secrets SET current_version = ?, updated_at = ? WHERE id = ?")
    .bind(version, now, secretId);
}

export async function deleteSecretRow(db: D1Database, secretId: string): Promise<void> {
  await db.prepare("DELETE FROM secrets WHERE id = ?").bind(secretId).run();
}

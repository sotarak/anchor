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

export type SecretWithVersion = { secret: SecretRow; current: VersionRow | null };

type JoinedRow = SecretRow & {
  v_version: number | null;
  v_alg: string | null;
  v_key_version: number | null;
  v_iv: unknown;
  v_ciphertext: unknown;
  v_comment: string | null;
};

// One statement reads the secret and its current version together, so a concurrent update or
// delete can never be observed half-applied (a missing version here means real corruption).
const JOINED_SELECT = `SELECT s.id, s.project_id, s.environment_id, s.path, s.key, s.current_version,
    s.updated_at, v.version AS v_version, v.alg AS v_alg, v.key_version AS v_key_version,
    v.iv AS v_iv, v.ciphertext AS v_ciphertext, v.comment AS v_comment
  FROM secrets s
  LEFT JOIN secret_versions v ON v.secret_id = s.id AND v.version = s.current_version`;

function splitJoined(r: JoinedRow): SecretWithVersion {
  const secret: SecretRow = {
    id: r.id,
    project_id: r.project_id,
    environment_id: r.environment_id,
    path: r.path,
    key: r.key,
    current_version: r.current_version,
    updated_at: r.updated_at,
  };
  if (r.v_version === null || r.v_alg === null || r.v_key_version === null) {
    return { secret, current: null };
  }
  return {
    secret,
    current: {
      secret_id: r.id,
      version: r.v_version,
      alg: r.v_alg,
      key_version: r.v_key_version,
      iv: toBytes(r.v_iv),
      ciphertext: toBytes(r.v_ciphertext),
      comment: r.v_comment ?? "",
    },
  };
}

export async function findSecretWithVersion(
  db: D1Database,
  environmentId: string,
  path: string,
  key: string,
): Promise<SecretWithVersion | null> {
  const row = await db
    .prepare(`${JOINED_SELECT} WHERE s.environment_id = ? AND s.path = ? AND s.key = ?`)
    .bind(environmentId, path, key)
    .first<JoinedRow>();
  return row ? splitJoined(row) : null;
}

export async function listSecretsWithVersions(
  db: D1Database,
  environmentId: string,
  path: string,
): Promise<SecretWithVersion[]> {
  const { results } = await db
    .prepare(`${JOINED_SELECT} WHERE s.environment_id = ? AND s.path = ? ORDER BY s.key`)
    .bind(environmentId, path)
    .all<JoinedRow>();
  return results.map(splitJoined);
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

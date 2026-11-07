import type { SecretValueType } from "@anchor/shared";
import { open, seal } from "#src/crypto/aead";
import { type RootKeyring, secretAad, secretAadV2 } from "#src/crypto/keyring";
import { toBytes } from "#src/lib/d1";
import { getProjectKek, type ProjectRow } from "#src/projects/repo";

/**
 * Re-seals the current version of `key` (any environment of `project`) under the given AAD
 * format and metadata, writing the matching columns. Simulates rows written before 0.4.0
 * (format 1) or typed rows without going through the API.
 */
export async function resealCurrentVersion(
  db: D1Database,
  keyring: RootKeyring,
  project: ProjectRow,
  key: string,
  to: { format: 1 | 2; type: SecretValueType; sensitive: boolean },
): Promise<void> {
  const row = await db
    .prepare(
      `SELECT s.id, s.environment_id, v.version, v.key_version, v.iv, v.ciphertext, v.value_type,
         v.sensitive, v.aad_format
       FROM secrets s JOIN secret_versions v ON v.secret_id = s.id AND v.version = s.current_version
       WHERE s.project_id = ? AND s.key = ?`,
    )
    .bind(project.id, key)
    .first<{
      id: string;
      environment_id: string;
      version: number;
      key_version: number;
      iv: unknown;
      ciphertext: unknown;
      value_type: SecretValueType;
      sensitive: number;
      aad_format: 1 | 2;
    }>();
  if (!row) throw new Error(`no secret ${key}`);
  const base = {
    projectId: project.id,
    environmentId: row.environment_id,
    secretId: row.id,
    version: row.version,
  };
  const aadOf = (format: 1 | 2, type: SecretValueType, sensitive: boolean) =>
    format === 1 ? secretAad(base) : secretAadV2({ ...base, type, sensitive });
  const kek = await getProjectKek(db, keyring, project, row.key_version);
  const plain = await open(
    kek,
    { iv: toBytes(row.iv), ciphertext: toBytes(row.ciphertext) },
    aadOf(row.aad_format, row.value_type, row.sensitive === 1),
  );
  const sealed = await seal(kek, plain, aadOf(to.format, to.type, to.sensitive));
  await db
    .prepare(
      `UPDATE secret_versions SET iv = ?, ciphertext = ?, aad_format = ?, value_type = ?, sensitive = ?
       WHERE secret_id = ? AND version = ?`,
    )
    .bind(
      sealed.iv,
      sealed.ciphertext,
      to.format,
      to.type,
      to.sensitive ? 1 : 0,
      row.id,
      row.version,
    )
    .run();
}

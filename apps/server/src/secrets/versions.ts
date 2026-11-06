import type { SecretDto, SecretVersionDto } from "@anchor/shared";
import { toBytes } from "../lib/d1";
import { ApiError } from "../lib/errors";
import type { VersionRow } from "./repo";
import { decryptVersion, putSecret, requireSecret, type SecretContext } from "./service";

type Address = { path: string; key: string };

type VersionMetaRow = {
  version: number;
  comment: string;
  created_at: number;
  created_by: string | null;
  email: string | null;
};

const META_SELECT = `SELECT v.version, v.comment, v.created_at, v.created_by, u.email
  FROM secret_versions v LEFT JOIN users u ON u.id = v.created_by`;

/** created_by holds a user id (service-token writes store NULL; see secrets/routes.ts). */
function toVersionDto(r: VersionMetaRow): SecretVersionDto {
  return {
    version: r.version,
    comment: r.comment,
    createdAt: r.created_at,
    createdBy: r.created_by && r.email ? { id: r.created_by, label: r.email } : null,
  };
}

/** Every version of a secret, newest first, without values. */
export async function listVersions(ctx: SecretContext, q: Address): Promise<SecretVersionDto[]> {
  const { secret } = await requireSecret(ctx, q.path, q.key);
  const { results } = await ctx.db
    .prepare(`${META_SELECT} WHERE v.secret_id = ? ORDER BY v.version DESC`)
    .bind(secret.id)
    .all<VersionMetaRow>();
  return results.map(toVersionDto);
}

/** One past (or current) version with its value, decrypted with that row's KEK and AAD. */
export async function getVersionValue(
  ctx: SecretContext,
  q: Address & { version: number },
): Promise<SecretVersionDto & { value: string }> {
  const { secret } = await requireSecret(ctx, q.path, q.key);
  const row = await ctx.db
    .prepare(
      `SELECT v.version, v.comment, v.created_at, v.created_by, u.email, v.alg, v.key_version,
         v.iv, v.ciphertext
       FROM secret_versions v LEFT JOIN users u ON u.id = v.created_by
       WHERE v.secret_id = ? AND v.version = ?`,
    )
    .bind(secret.id, q.version)
    .first<
      VersionMetaRow & { alg: string; key_version: number; iv: unknown; ciphertext: unknown }
    >();
  if (!row) throw new ApiError(404, "not_found", "Version not found");
  const version: VersionRow = {
    secret_id: secret.id,
    version: row.version,
    alg: row.alg,
    key_version: row.key_version,
    iv: toBytes(row.iv),
    ciphertext: toBytes(row.ciphertext),
    comment: row.comment,
  };
  const value = await decryptVersion(ctx, new Map(), secret.id, version, q.version);
  return { ...toVersionDto(row), value };
}

/**
 * Writes the value and comment of `version` as a new version, under the current KEK and with
 * the new version's AAD (it goes through putSecret). Content equal to the current one is a no-op.
 */
export async function rollbackSecret(
  ctx: SecretContext,
  q: Address & { version: number },
): Promise<{ secret: SecretDto; changed: boolean; fromVersion: number }> {
  const { secret: before } = await requireSecret(ctx, q.path, q.key);
  const old = await getVersionValue(ctx, q);
  const { secret, changed } = await putSecret(ctx, {
    path: q.path,
    key: q.key,
    value: old.value,
    comment: old.comment,
  });
  return { secret, changed, fromVersion: before.current_version };
}

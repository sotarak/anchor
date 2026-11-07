import type { SecretDto } from "@anchor/shared";
import { AEAD_ALG, open, seal } from "../crypto/aead";
import { type RootKeyring, secretAad } from "../crypto/keyring";
import { ensureFolders } from "../folders/repo";
import { isRetiredKekWrite, isUniqueViolation } from "../lib/d1";
import { utf8Decode, utf8Encode } from "../lib/encoding";
import { ApiError, IntegrityError } from "../lib/errors";
import { newId } from "../lib/random";
import { type EnvironmentRow, getProjectKek, type ProjectRow } from "../projects/repo";
import {
  deleteSecretRow,
  findSecretWithVersion,
  insertSecretStatement,
  insertVersionStatement,
  listSecretsWithVersions,
  type SecretRow,
  type SecretWithVersion,
  setCurrentVersionStatement,
  type VersionRow,
} from "./repo";

export type SecretContext = {
  db: D1Database;
  keyring: RootKeyring;
  project: ProjectRow;
  environment: EnvironmentRow;
  actorId: string | null;
  now: number;
};

const CONFLICT = "Secret was modified concurrently, retry";

/** Unwrapped KEKs live only for the duration of one service call. */
export type KekCache = Map<number, CryptoKey>;

async function kekFor(ctx: SecretContext, cache: KekCache, version: number): Promise<CryptoKey> {
  let kek = cache.get(version);
  if (!kek) {
    kek = await getProjectKek(ctx.db, ctx.keyring, ctx.project, version);
    cache.set(version, kek);
  }
  return kek;
}

function aadFor(ctx: SecretContext, secretId: string, version: number): string {
  return secretAad({
    projectId: ctx.project.id,
    environmentId: ctx.environment.id,
    secretId,
    version,
  });
}

export async function decryptVersion(
  ctx: SecretContext,
  cache: KekCache,
  secretId: string,
  v: VersionRow | null | undefined,
  expectedVersion: number,
): Promise<string> {
  const fail = () =>
    new IntegrityError("secret decrypt failed", { sid: secretId, version: expectedVersion });
  if (!v || v.version !== expectedVersion || v.alg !== AEAD_ALG) throw fail();
  const kek = await kekFor(ctx, cache, v.key_version);
  try {
    const plain = await open(
      kek,
      { iv: v.iv, ciphertext: v.ciphertext },
      aadFor(ctx, secretId, v.version),
    );
    return utf8Decode(plain);
  } catch {
    throw fail();
  }
}

async function encryptVersion(
  ctx: SecretContext,
  cache: KekCache,
  secretId: string,
  version: number,
  value: string,
  comment: string,
): Promise<VersionRow> {
  const keyVersion = ctx.project.current_key_version;
  const kek = await kekFor(ctx, cache, keyVersion);
  const sealed = await seal(kek, utf8Encode(value), aadFor(ctx, secretId, version));
  return {
    secret_id: secretId,
    version,
    alg: AEAD_ALG,
    key_version: keyVersion,
    iv: sealed.iv,
    ciphertext: sealed.ciphertext,
    comment,
  };
}

function toDto(
  row: SecretRow,
  version: number,
  comment: string,
  updatedAt: number,
  value?: string,
): SecretDto {
  const dto: SecretDto = { key: row.key, path: row.path, version, comment, updatedAt };
  if (value !== undefined) dto.value = value;
  return dto;
}

async function batchOrConflict(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  try {
    await db.batch(statements);
  } catch (err) {
    // A version insert under a KEK a rotation retired meanwhile: the batch rolled back, retry.
    if (isUniqueViolation(err) || isRetiredKekWrite(err)) {
      throw new ApiError(409, "conflict", CONFLICT);
    }
    throw err;
  }
}

export async function requireSecret(
  ctx: SecretContext,
  path: string,
  key: string,
): Promise<SecretWithVersion> {
  const found = await findSecretWithVersion(ctx.db, ctx.environment.id, path, key);
  if (!found) throw new ApiError(404, "not_found", "Secret not found");
  return found;
}

export async function putSecret(
  ctx: SecretContext,
  input: { path: string; key: string; value: string; comment: string },
): Promise<{ secret: SecretDto; created: boolean; changed: boolean }> {
  const cache: KekCache = new Map();
  const found = await findSecretWithVersion(ctx.db, ctx.environment.id, input.path, input.key);

  if (!found) {
    const row: SecretRow = {
      id: newId(),
      project_id: ctx.project.id,
      environment_id: ctx.environment.id,
      path: input.path,
      key: input.key,
      current_version: 1,
      updated_at: ctx.now,
    };
    const v = await encryptVersion(ctx, cache, row.id, 1, input.value, input.comment);
    await batchOrConflict(ctx.db, [
      insertSecretStatement(ctx.db, row, ctx.now),
      insertVersionStatement(ctx.db, v, ctx.actorId, ctx.now),
      ...ensureFolders(ctx.db, ctx.environment.id, input.path, ctx.now),
    ]);
    return { secret: toDto(row, 1, input.comment, ctx.now), created: true, changed: true };
  }

  const { secret: existing, current } = found;
  const currentValue = await decryptVersion(
    ctx,
    cache,
    existing.id,
    current,
    existing.current_version,
  );
  if (currentValue === input.value && current?.comment === input.comment) {
    const secret = toDto(existing, existing.current_version, input.comment, existing.updated_at);
    return { secret, created: false, changed: false };
  }

  const next = existing.current_version + 1;
  const v = await encryptVersion(ctx, cache, existing.id, next, input.value, input.comment);
  // The version insert fails on the (secret_id, version) PK if another writer got there first,
  // which rolls back the whole batch: no orphan version, current_version unchanged.
  await batchOrConflict(ctx.db, [
    insertVersionStatement(ctx.db, v, ctx.actorId, ctx.now),
    setCurrentVersionStatement(ctx.db, existing.id, next, ctx.now),
    ...ensureFolders(ctx.db, ctx.environment.id, input.path, ctx.now),
  ]);
  return { secret: toDto(existing, next, input.comment, ctx.now), created: false, changed: true };
}

export async function listSecrets(
  ctx: SecretContext,
  q: { path: string; reveal: boolean },
): Promise<SecretDto[]> {
  const rows = await listSecretsWithVersions(ctx.db, ctx.environment.id, q.path);
  const cache: KekCache = new Map();
  const out: SecretDto[] = [];
  for (const { secret: row, current } of rows) {
    const value = q.reveal
      ? await decryptVersion(ctx, cache, row.id, current, row.current_version)
      : undefined;
    out.push(toDto(row, row.current_version, current?.comment ?? "", row.updated_at, value));
  }
  return out;
}

export async function getSecret(
  ctx: SecretContext,
  q: { path: string; key: string },
): Promise<SecretDto> {
  const { secret: row, current } = await requireSecret(ctx, q.path, q.key);
  const value = await decryptVersion(ctx, new Map(), row.id, current, row.current_version);
  return toDto(row, row.current_version, current?.comment ?? "", row.updated_at, value);
}

export async function deleteSecret(
  ctx: SecretContext,
  q: { path: string; key: string },
): Promise<void> {
  const { secret } = await requireSecret(ctx, q.path, q.key);
  await deleteSecretRow(ctx.db, secret.id);
}

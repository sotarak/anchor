import type { Bindings } from "../env";
import { toBytes } from "../lib/d1";
import { fromBase64 } from "../lib/encoding";
import { ConfigError, IntegrityError } from "../lib/errors";
import { randomBytes } from "../lib/random";
import { importAesKey, open, seal } from "./aead";

export const DEFAULT_ROOT_KEY_ID = "rk1";
const ROOT_KEY_ID_PATTERN = /^[a-z0-9-]{1,32}$/;

export type RootKeyEnv = Pick<
  Bindings,
  | "ANCHOR_ROOT_KEY"
  | "ANCHOR_ROOT_KEY_ID"
  | "ANCHOR_ROOT_KEY_PREVIOUS"
  | "ANCHOR_ROOT_KEY_PREVIOUS_ID"
>;

/** The current root key wraps new KEKs; the previous one only opens KEKs not yet re-wrapped. */
export type RootKeyring = {
  current: { id: string; key: CryptoKey };
  previous: { id: string; key: CryptoKey } | null;
};

let cached: { raw: string; keyring: RootKeyring } | undefined;

/** Imports a 32-byte base64 key as a non-extractable AES key. Errors name the variable only. */
async function importRootKey(raw: string | undefined, variable: string): Promise<CryptoKey> {
  const error = () => new ConfigError(`${variable} must be 32 bytes, base64-encoded`);
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(raw ?? "");
  } catch {
    throw error();
  }
  if (bytes.byteLength !== 32) throw error();
  try {
    return await importAesKey(bytes);
  } finally {
    bytes.fill(0);
  }
}

function checkId(id: string, variable: string): string {
  if (!ROOT_KEY_ID_PATTERN.test(id)) {
    throw new ConfigError(`${variable} must match ${ROOT_KEY_ID_PATTERN.source}`);
  }
  return id;
}

/**
 * Reads ANCHOR_ROOT_KEY (+ _ID, default rk1) and the optional ANCHOR_ROOT_KEY_PREVIOUS (+ _ID),
 * imported once per isolate for the same strings. Fails closed with a ConfigError that names
 * the variable, never its value. A previous id without a previous key is ignored: that is the
 * state after the previous key was removed post-rewrap.
 */
export async function getRootKeyring(env: RootKeyEnv): Promise<RootKeyring> {
  const raw = JSON.stringify([
    env.ANCHOR_ROOT_KEY,
    env.ANCHOR_ROOT_KEY_ID,
    env.ANCHOR_ROOT_KEY_PREVIOUS,
    env.ANCHOR_ROOT_KEY_PREVIOUS_ID,
  ]);
  if (cached && cached.raw === raw) return cached.keyring;

  const currentId = checkId(env.ANCHOR_ROOT_KEY_ID ?? DEFAULT_ROOT_KEY_ID, "ANCHOR_ROOT_KEY_ID");
  const current = {
    id: currentId,
    key: await importRootKey(env.ANCHOR_ROOT_KEY, "ANCHOR_ROOT_KEY"),
  };
  let previous: RootKeyring["previous"] = null;
  if (env.ANCHOR_ROOT_KEY_PREVIOUS) {
    if (!env.ANCHOR_ROOT_KEY_PREVIOUS_ID) {
      throw new ConfigError(
        "ANCHOR_ROOT_KEY_PREVIOUS_ID is required when ANCHOR_ROOT_KEY_PREVIOUS is set",
      );
    }
    const previousId = checkId(env.ANCHOR_ROOT_KEY_PREVIOUS_ID, "ANCHOR_ROOT_KEY_PREVIOUS_ID");
    if (previousId === currentId) {
      throw new ConfigError("ANCHOR_ROOT_KEY_PREVIOUS_ID must differ from ANCHOR_ROOT_KEY_ID");
    }
    previous = {
      id: previousId,
      key: await importRootKey(env.ANCHOR_ROOT_KEY_PREVIOUS, "ANCHOR_ROOT_KEY_PREVIOUS"),
    };
  }
  const keyring = { current, previous };
  cached = { raw, keyring };
  return keyring;
}

/** The root key a wrapped KEK names, or null when that id is not configured. */
export function rootKeyFor(keyring: RootKeyring, rootKeyId: string): CryptoKey | null {
  if (rootKeyId === keyring.current.id) return keyring.current.key;
  if (keyring.previous && rootKeyId === keyring.previous.id) return keyring.previous.key;
  return null;
}

export function kekAad(projectId: string, version: number): string {
  return `anchor/kek/v1|${projectId}|${version}`;
}

export function secretAad(p: {
  projectId: string;
  environmentId: string;
  secretId: string;
  version: number;
}): string {
  return `anchor/secret/v1|${p.projectId}|${p.environmentId}|${p.secretId}|${p.version}`;
}

export type WrappedKek = {
  projectId: string;
  version: number;
  rootKeyId: string;
  iv: Uint8Array;
  wrappedKey: Uint8Array;
};

export async function createWrappedKek(
  keyring: RootKeyring,
  projectId: string,
  version: number,
): Promise<WrappedKek> {
  const raw = randomBytes(32);
  const sealed = await seal(keyring.current.key, raw, kekAad(projectId, version));
  raw.fill(0);
  return {
    projectId,
    version,
    rootKeyId: keyring.current.id,
    iv: sealed.iv,
    wrappedKey: sealed.ciphertext,
  };
}

const unwrapFailed = (w: WrappedKek) =>
  new IntegrityError("kek unwrap failed", { projectId: w.projectId, kekVersion: w.version });

/**
 * Raw KEK bytes, opened with the root key the row names. Callers must zero them. Only key
 * re-wrapping needs raw bytes; everything else uses unwrapKek's non-extractable key.
 */
export async function unwrapKekBytes(keyring: RootKeyring, w: WrappedKek): Promise<Uint8Array> {
  const rootKey = rootKeyFor(keyring, w.rootKeyId);
  if (!rootKey) throw unwrapFailed(w);
  try {
    return await open(
      rootKey,
      { iv: w.iv, ciphertext: w.wrappedKey },
      kekAad(w.projectId, w.version),
    );
  } catch {
    throw unwrapFailed(w);
  }
}

export async function unwrapKek(keyring: RootKeyring, w: WrappedKek): Promise<CryptoKey> {
  const raw = await unwrapKekBytes(keyring, w);
  try {
    return await importAesKey(raw);
  } catch {
    throw unwrapFailed(w);
  } finally {
    raw.fill(0);
  }
}

/**
 * Re-wraps every KEK that is not under the current root key, 100 rows at a time. Each page is
 * fully unwrapped before any row is written, so a row that does not open aborts the page with
 * nothing written. Updates are conditional on the old root key id, so a concurrent rewrap of
 * the same row is a no-op. Returns the number of rows re-wrapped.
 */
export async function rewrapAllKeks(db: D1Database, keyring: RootKeyring): Promise<number> {
  let count = 0;
  for (;;) {
    const { results } = await db
      .prepare(
        `SELECT project_id, version, root_key_id, iv, wrapped_key FROM project_keys
         WHERE root_key_id != ? ORDER BY project_id, version LIMIT 100`,
      )
      .bind(keyring.current.id)
      .all<{
        project_id: string;
        version: number;
        root_key_id: string;
        iv: unknown;
        wrapped_key: unknown;
      }>();
    if (results.length === 0) return count;
    const updates: D1PreparedStatement[] = [];
    for (const row of results) {
      const w: WrappedKek = {
        projectId: row.project_id,
        version: row.version,
        rootKeyId: row.root_key_id,
        iv: toBytes(row.iv),
        wrappedKey: toBytes(row.wrapped_key),
      };
      const raw = await unwrapKekBytes(keyring, w);
      const sealed = await seal(keyring.current.key, raw, kekAad(w.projectId, w.version));
      raw.fill(0);
      updates.push(
        db
          .prepare(
            `UPDATE project_keys SET root_key_id = ?, iv = ?, wrapped_key = ?
             WHERE project_id = ? AND version = ? AND root_key_id = ?`,
          )
          .bind(
            keyring.current.id,
            sealed.iv,
            sealed.ciphertext,
            w.projectId,
            w.version,
            w.rootKeyId,
          ),
      );
    }
    const written = await db.batch(updates);
    const changed = written.reduce((n, r) => n + r.meta.changes, 0);
    count += changed;
    // Every selected row was taken by a concurrent rewrap: the next page is empty or new.
    if (changed === 0 && results.length < 100) return count;
  }
}

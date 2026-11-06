import type { Bindings } from "../env";
import { fromBase64 } from "../lib/encoding";
import { ConfigError, IntegrityError } from "../lib/errors";
import { randomBytes } from "../lib/random";
import { importAesKey, open, seal } from "./aead";

export const ROOT_KEY_ID = "rk1";
const ROOT_KEY_ERROR = "ANCHOR_ROOT_KEY must be 32 bytes, base64-encoded";

let cached: { raw: string; key: CryptoKey } | undefined;

/** Imports ANCHOR_ROOT_KEY once per isolate as a non-extractable key. Fails closed. */
export async function getRootKey(env: Pick<Bindings, "ANCHOR_ROOT_KEY">): Promise<CryptoKey> {
  const raw = env.ANCHOR_ROOT_KEY;
  if (cached && cached.raw === raw) return cached.key;
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(raw ?? "");
  } catch {
    throw new ConfigError(ROOT_KEY_ERROR);
  }
  if (bytes.byteLength !== 32) throw new ConfigError(ROOT_KEY_ERROR);
  const key = await importAesKey(bytes);
  bytes.fill(0);
  cached = { raw, key };
  return key;
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
  rootKey: CryptoKey,
  projectId: string,
  version: number,
): Promise<WrappedKek> {
  const raw = randomBytes(32);
  const sealed = await seal(rootKey, raw, kekAad(projectId, version));
  raw.fill(0);
  return {
    projectId,
    version,
    rootKeyId: ROOT_KEY_ID,
    iv: sealed.iv,
    wrappedKey: sealed.ciphertext,
  };
}

export async function unwrapKek(rootKey: CryptoKey, w: WrappedKek): Promise<CryptoKey> {
  const fail = () =>
    new IntegrityError("kek unwrap failed", { projectId: w.projectId, kekVersion: w.version });
  if (w.rootKeyId !== ROOT_KEY_ID) throw fail();
  let raw: Uint8Array;
  try {
    raw = await open(
      rootKey,
      { iv: w.iv, ciphertext: w.wrappedKey },
      kekAad(w.projectId, w.version),
    );
  } catch {
    throw fail();
  }
  try {
    return await importAesKey(raw);
  } catch {
    throw fail();
  } finally {
    raw.fill(0);
  }
}

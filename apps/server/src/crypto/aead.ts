import { utf8Encode } from "../lib/encoding";
import { randomBytes } from "../lib/random";

export const AEAD_ALG = "A256GCM";
const IV_BYTES = 12;
const TAG_BITS = 128;

export type Sealed = { iv: Uint8Array; ciphertext: Uint8Array };

/** Any authentication or format failure. Deliberately carries no detail. */
export class DecryptError extends Error {
  constructor() {
    super("decrypt failed");
    this.name = "DecryptError";
  }
}

/** Imports a 32-byte AES-256-GCM key as non-extractable. */
export async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.byteLength !== 32) throw new Error("AES key must be 32 bytes");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function seal(key: CryptoKey, plaintext: Uint8Array, aad: string): Promise<Sealed> {
  const iv = randomBytes(IV_BYTES);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: utf8Encode(aad), tagLength: TAG_BITS },
    key,
    plaintext,
  );
  return { iv, ciphertext: new Uint8Array(ct) };
}

export async function open(key: CryptoKey, sealed: Sealed, aad: string): Promise<Uint8Array> {
  if (sealed.iv.byteLength !== IV_BYTES) throw new DecryptError();
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: sealed.iv, additionalData: utf8Encode(aad), tagLength: TAG_BITS },
      key,
      sealed.ciphertext,
    );
    return new Uint8Array(pt);
  } catch {
    throw new DecryptError();
  }
}

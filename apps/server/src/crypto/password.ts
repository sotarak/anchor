import { fromBase64, toBase64, utf8Encode } from "../lib/encoding";
import { randomBytes } from "../lib/random";

/** workerd's maximum PBKDF2 iteration count (see spec §6.3 / §12). */
export const PBKDF2_ITERATIONS = 100_000;
const MIN_ITERATIONS = 10_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const ALG = "pbkdf2-sha256";

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", utf8Encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

/** Returns `pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `${ALG}$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/** Constant-time verification. Returns false (never throws) for any malformed stored value. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4) return false;
  const [alg, iterText, saltText, hashText] = parts as [string, string, string, string];
  if (alg !== ALG || !/^[0-9]+$/.test(iterText)) return false;
  const iterations = Number(iterText);
  if (iterations < MIN_ITERATIONS || iterations > PBKDF2_ITERATIONS) return false;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromBase64(saltText);
    expected = fromBase64(hashText);
  } catch {
    return false;
  }
  if (salt.byteLength !== SALT_BYTES || expected.byteLength !== HASH_BYTES) return false;
  const actual = await derive(password, salt, iterations);
  return crypto.subtle.timingSafeEqual(actual, expected);
}

let dummyHash: Promise<string> | undefined;

/** Spends the same work as a real verification; used when the email is unknown. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword(crypto.randomUUID());
  await verifyPassword(password, await dummyHash);
  return false;
}

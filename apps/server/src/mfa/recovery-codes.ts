import { utf8Encode } from "../lib/encoding";
import { randomBytes } from "../lib/random";

/**
 * Single-use recovery codes (spec 2026-11-22-v0.6.0-mfa): 10 codes of 10 base32 characters
 * (50 bits each), shown as `xxxxx-xxxxx`. 32 symbols divide 256, so `byte & 31` is uniform.
 * Stored as a per-user salted PBKDF2 hash (see `hashRecoveryCode`).
 */
export const RECOVERY_CODE_COUNT = 10;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const NORMALIZED = /^[a-z2-7]{10}$/;

function generateOne(): string {
  const chars = Array.from(randomBytes(10), (b) => ALPHABET[b & 31]).join("");
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

export function generateRecoveryCodes(): string[] {
  const codes = new Set<string>();
  while (codes.size < RECOVERY_CODE_COUNT) codes.add(generateOne());
  return [...codes];
}

/** Lower case without hyphens or whitespace; null unless exactly 10 alphabet characters. */
export function normalizeRecoveryCode(input: string): string | null {
  const normalized = input.toLowerCase().replace(/[\s-]/g, "");
  return NORMALIZED.test(normalized) ? normalized : null;
}

/**
 * PBKDF2 work per guess. A code has 50 bits, too few for a plain hash: a D1 dump hashed with
 * unsalted SHA-256 could be swept for every user at once in hours. Salting with the user id makes
 * each account its own search and this count multiplies its cost; one check costs a tenth of a
 * password verification, a full set of 10 about one.
 */
export const RECOVERY_CODE_ITERATIONS = 10_000;
const SALT_PREFIX = "anchor/recovery/v1|";

/** Hex PBKDF2-SHA-256 of a normalized code, salted with its user (deterministic, for lookup). */
export async function hashRecoveryCode(userId: string, normalized: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", utf8Encode(normalized), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: utf8Encode(`${SALT_PREFIX}${userId}`),
      iterations: RECOVERY_CODE_ITERATIONS,
    },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, "0")).join("");
}

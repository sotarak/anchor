import { randomBytes, sha256Hex } from "../lib/random";

/**
 * Single-use recovery codes (spec 2026-11-22-v0.6.0-mfa): 10 codes of 10 base32 characters
 * (50 bits each), shown as `xxxxx-xxxxx`. 32 symbols divide 256, so `byte & 31` is uniform.
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

export function hashRecoveryCode(normalized: string): Promise<string> {
  return sha256Hex(normalized);
}

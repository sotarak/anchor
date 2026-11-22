import { describe, expect, it } from "vitest";
import { utf8Encode } from "#src/lib/encoding";
import { sha256Hex } from "#src/lib/random";
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_ITERATIONS,
} from "#src/mfa/recovery-codes";

async function pbkdf2Hex(code: string, salt: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", utf8Encode(code), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: utf8Encode(salt), iterations },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, "0")).join("");
}

describe("recovery codes", () => {
  it("generates 10 unique codes in the xxxxx-xxxxx base32 form", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(RECOVERY_CODE_COUNT).toBe(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
  });

  it("normalizes case, spaces and the hyphen", () => {
    for (const input of [" ABCDE fghij ", "abcde-fghij", "abcdefghij", "ABCDE-FGHIJ"]) {
      expect(normalizeRecoveryCode(input)).toBe("abcdefghij");
    }
  });

  it("rejects wrong length or characters outside the alphabet", () => {
    for (const input of ["abcde-fghi", "abcde-fghi1", "", "abcde-fghij-k", "abcde-fgh0j"]) {
      expect(normalizeRecoveryCode(input)).toBeNull();
    }
  });

  it("hashes with PBKDF2-SHA-256 salted by the user, deterministic per user", async () => {
    const h = await hashRecoveryCode("u-1", "abcdefghij");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(RECOVERY_CODE_ITERATIONS).toBe(10_000);
    expect(h).toBe(await pbkdf2Hex("abcdefghij", "anchor/recovery/v1|u-1", 10_000));
    expect(await hashRecoveryCode("u-1", "abcdefghij")).toBe(h);
    expect(await hashRecoveryCode("u-1", "abcdefghik")).not.toBe(h);
  });

  it("a D1 dump cannot be swept with one fast hash: no plain SHA-256, a different hash per user", async () => {
    const h = await hashRecoveryCode("u-1", "abcdefghij");
    expect(h).not.toBe(await sha256Hex("abcdefghij"));
    expect(await hashRecoveryCode("u-2", "abcdefghij")).not.toBe(h);
  });
});

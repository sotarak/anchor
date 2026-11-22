import { describe, expect, it } from "vitest";
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
} from "#src/mfa/recovery-codes";

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

  it("hashes the normalized code with SHA-256 hex", async () => {
    const h = await hashRecoveryCode("abcdefghij");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashRecoveryCode("abcdefghij")).toBe(h);
    expect(await hashRecoveryCode("abcdefghik")).not.toBe(h);
  });
});

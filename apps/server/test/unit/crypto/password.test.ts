import { describe, expect, it } from "vitest";
import {
  hashPassword,
  PBKDF2_ITERATIONS,
  verifyAgainstDummy,
  verifyPassword,
} from "#src/crypto/password";

const PW = "correct horse battery staple";

describe("PBKDF2 password hashing", () => {
  it("workerd accepts 100,000 PBKDF2 iterations", async () => {
    expect(PBKDF2_ITERATIONS).toBe(100_000);
    await expect(hashPassword(PW)).resolves.toBeTypeOf("string");
  });

  it("hash has the documented format", async () => {
    expect(await hashPassword(PW)).toMatch(
      /^pbkdf2-sha256\$100000\$[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{44}$/,
    );
  });

  it("same password hashes differently (random salt)", async () => {
    expect(await hashPassword(PW)).not.toBe(await hashPassword(PW));
  });

  it("verify succeeds for the right password and fails for a wrong one, including one-char difference and different case", async () => {
    const stored = await hashPassword(PW);
    expect(await verifyPassword(PW, stored)).toBe(true);
    expect(await verifyPassword(`${PW}!`, stored)).toBe(false);
    expect(await verifyPassword(PW.slice(0, -1), stored)).toBe(false);
    expect(await verifyPassword(PW.toUpperCase(), stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("verify returns false for malformed stored strings", async () => {
    const [, , salt, hash] = (await hashPassword(PW)).split("$");
    const malformed = [
      "",
      "pbkdf2-sha256$100000$abc",
      "bcrypt$2b$10$abcdefghijklmnopqrstuv",
      `pbkdf2-sha256$999999999$${salt}$${hash}`,
      `pbkdf2-sha256$9999$${salt}$${hash}`,
      `pbkdf2-sha256$100000$!!bad-b64!!$${hash}`,
      `pbkdf2-sha256$100000$${salt}$AAAA`,
      `pbkdf2-sha256$1e5$${salt}$${hash}`,
      `pbkdf2-sha256$100000$${salt}$${hash}$extra`,
    ];
    for (const stored of malformed) {
      expect(await verifyPassword(PW, stored), stored).toBe(false);
    }
  });

  it("verifyAgainstDummy returns false", async () => {
    expect(await verifyAgainstDummy(PW)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { utf8Encode } from "#src/lib/encoding";
import {
  base32Decode,
  base32Encode,
  hotp,
  matchTotp,
  otpauthUri,
  TOTP_SECRET_BYTES,
  timeStep,
} from "#src/mfa/totp";

const RFC_SECRET = utf8Encode("12345678901234567890");
const RFC_VECTORS: [number, string][] = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

describe("hotp / timeStep (RFC 6238 SHA-1 vectors)", () => {
  for (const [t, expected] of RFC_VECTORS) {
    it(`T=${t} gives ${expected} (8 digits) and its last six digits`, async () => {
      const step = timeStep(t * 1000);
      expect(await hotp(RFC_SECRET, step, 8)).toBe(expected);
      expect(await hotp(RFC_SECRET, step)).toBe(expected.slice(2));
    });
  }
});

describe("matchTotp", () => {
  const now = 1_700_000_000_000;
  const step = timeStep(now);
  const codeAt = (s: number) => hotp(RFC_SECRET, s);

  it("accepts the previous, current and next step and returns which one", async () => {
    expect(await matchTotp(RFC_SECRET, await codeAt(step - 1), now)).toBe(step - 1);
    expect(await matchTotp(RFC_SECRET, await codeAt(step), now)).toBe(step);
    expect(await matchTotp(RFC_SECRET, await codeAt(step + 1), now)).toBe(step + 1);
  });

  it("refuses codes two steps away", async () => {
    expect(await matchTotp(RFC_SECRET, await codeAt(step - 2), now)).toBeNull();
    expect(await matchTotp(RFC_SECRET, await codeAt(step + 2), now)).toBeNull();
  });

  it("accepts a code typed with spaces or a hyphen, the way apps display it", async () => {
    const code = await codeAt(step);
    for (const typed of [
      `${code.slice(0, 3)} ${code.slice(3)}`,
      ` ${code} `,
      `${code.slice(0, 3)}-${code.slice(3)}`,
    ]) {
      expect(await matchTotp(RFC_SECRET, typed, now)).toBe(step);
    }
  });

  it("refuses anything but exactly six ASCII digits", async () => {
    for (const code of ["12345", "1234567", "12 456", "١٢٣٤٥٦", "abcdef", ""]) {
      expect(await matchTotp(RFC_SECRET, code, now)).toBeNull();
    }
  });
});

describe("base32", () => {
  it("encodes the RFC 4648 vector", () => {
    expect(base32Encode(utf8Encode("foobar"))).toBe("MZXW6YTBOI");
  });

  it("round-trips a secret as 32 characters without padding", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(TOTP_SECRET_BYTES));
    const text = base32Encode(bytes);
    expect(text).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(text)).toEqual(bytes);
  });

  it("decoding rejects characters outside the alphabet", () => {
    expect(() => base32Decode("MZXW1")).toThrow();
  });
});

describe("otpauthUri", () => {
  it("names the instance in the issuer and escapes the account", () => {
    expect(otpauthUri({ secret: "ABC", email: "a+b@x.io", hostname: "anchor.example" })).toBe(
      "otpauth://totp/Anchor%20(anchor.example)%3Aa%2Bb%40x.io?secret=ABC&issuer=Anchor%20(anchor.example)&algorithm=SHA1&digits=6&period=30",
    );
  });
});

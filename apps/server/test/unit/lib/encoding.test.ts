import { describe, expect, it } from "vitest";
import { fromBase64, fromBase64Url, toBase64, toBase64Url, toHex } from "#src/lib/encoding";
import { newSessionToken, sha256Hex } from "#src/lib/random";

describe("encoding helpers", () => {
  it("base64 and base64url round-trip all byte values", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    expect(toBase64Url(bytes)).not.toMatch(/[+/=]/);
  });
  it("fromBase64 throws on invalid input", () => {
    expect(() => fromBase64("not base64!!")).toThrow();
  });
  it("toHex", () => expect(toHex(new Uint8Array([0, 15, 255]))).toBe("000fff"));
  it("session tokens have the anc_s_ prefix and 32 random bytes", () => {
    const t = newSessionToken();
    expect(t).toMatch(/^anc_s_[A-Za-z0-9_-]{43}$/);
    expect(fromBase64Url(t.slice(6)).length).toBe(32);
    expect(newSessionToken()).not.toBe(t);
  });
  it("sha256Hex", async () =>
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    ));
});

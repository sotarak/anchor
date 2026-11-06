import { describe, expect, it } from "vitest";
import { DecryptError, importAesKey, open, type Sealed, seal } from "#src/crypto/aead";
import { toBase64, utf8Decode, utf8Encode } from "#src/lib/encoding";
import { randomBytes } from "#src/lib/random";

const AAD = "anchor/secret/v1|p|e|s|1";
const newKey = () => importAesKey(randomBytes(32));

function flipBit(bytes: Uint8Array, byteIndex: number, bit: number): Uint8Array {
  const copy = bytes.slice();
  copy[byteIndex] = (copy[byteIndex] ?? 0) ^ (1 << bit);
  return copy;
}

describe("AES-256-GCM seal/open", () => {
  it("round-trips arbitrary bytes including empty", async () => {
    const key = await newKey();
    for (const plain of [new Uint8Array(0), utf8Encode("hello 🔑"), randomBytes(4096)]) {
      const sealed = await seal(key, plain, AAD);
      expect(await open(key, sealed, AAD)).toEqual(plain);
    }
    expect(utf8Decode(await open(key, await seal(key, utf8Encode("x"), AAD), AAD))).toBe("x");
  });

  it("fails when any single bit of ciphertext is flipped", async () => {
    const key = await newKey();
    const sealed = await seal(key, utf8Encode("some secret value"), AAD);
    const n = sealed.ciphertext.length;
    for (const byteIndex of [0, Math.floor(n / 2), n - 1]) {
      for (let bit = 0; bit < 8; bit++) {
        const tampered: Sealed = {
          iv: sealed.iv,
          ciphertext: flipBit(sealed.ciphertext, byteIndex, bit),
        };
        await expect(open(key, tampered, AAD)).rejects.toBeInstanceOf(DecryptError);
      }
    }
  });

  it("fails when a bit of the IV is flipped", async () => {
    const key = await newKey();
    const sealed = await seal(key, utf8Encode("v"), AAD);
    const tampered: Sealed = { iv: flipBit(sealed.iv, 5, 3), ciphertext: sealed.ciphertext };
    await expect(open(key, tampered, AAD)).rejects.toBeInstanceOf(DecryptError);
  });

  it("fails with different AAD", async () => {
    const key = await newKey();
    const sealed = await seal(key, utf8Encode("v"), AAD);
    await expect(open(key, sealed, "anchor/secret/v1|p|e|s|2")).rejects.toBeInstanceOf(
      DecryptError,
    );
  });

  it("fails with a different key", async () => {
    const sealed = await seal(await newKey(), utf8Encode("v"), AAD);
    await expect(open(await newKey(), sealed, AAD)).rejects.toBeInstanceOf(DecryptError);
  });

  it("uses a unique 12-byte IV across 10,000 seals", async () => {
    const key = await newKey();
    const ivs = new Set<string>();
    const plain = utf8Encode("v");
    for (let i = 0; i < 10_000; i++) {
      const { iv } = await seal(key, plain, AAD);
      expect(iv.length).toBe(12);
      ivs.add(toBase64(iv));
    }
    expect(ivs.size).toBe(10_000);
  });

  it("importAesKey rejects 16- and 33-byte keys", async () => {
    await expect(importAesKey(randomBytes(16))).rejects.toThrow("AES key must be 32 bytes");
    await expect(importAesKey(randomBytes(33))).rejects.toThrow("AES key must be 32 bytes");
  });

  it("importAesKey returns a non-extractable key", async () => {
    const key = await newKey();
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });
});

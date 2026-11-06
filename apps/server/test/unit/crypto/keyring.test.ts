import { describe, expect, it } from "vitest";
import { open, seal } from "#src/crypto/aead";
import {
  createWrappedKek,
  getRootKey,
  kekAad,
  ROOT_KEY_ID,
  secretAad,
  unwrapKek,
  type WrappedKek,
} from "#src/crypto/keyring";
import { toBase64, utf8Encode } from "#src/lib/encoding";
import { ConfigError, IntegrityError } from "#src/lib/errors";
import { randomBytes } from "#src/lib/random";

const rootB64 = () => toBase64(randomBytes(32));
const rootKey = () => getRootKey({ ANCHOR_ROOT_KEY: rootB64() });

describe("getRootKey", () => {
  it("rejects missing, non-base64, and 16-byte keys with ConfigError", async () => {
    const short = toBase64(randomBytes(16));
    for (const bad of ["", "not-base64-!!", short, `${rootB64()}AA==`]) {
      const err = await getRootKey({ ANCHOR_ROOT_KEY: bad }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).toBe("ANCHOR_ROOT_KEY must be 32 bytes, base64-encoded");
      if (bad) expect((err as Error).message).not.toContain(bad);
    }
    const missing = await getRootKey({} as { ANCHOR_ROOT_KEY: string }).catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(ConfigError);
  });

  it("returns the cached key for the same string and a new key for a different one", async () => {
    const b64 = rootB64();
    const a = await getRootKey({ ANCHOR_ROOT_KEY: b64 });
    expect(await getRootKey({ ANCHOR_ROOT_KEY: b64 })).toBe(a);
    expect(await getRootKey({ ANCHOR_ROOT_KEY: rootB64() })).not.toBe(a);
  });
});

describe("AAD builders", () => {
  it("use the exact documented formats", () => {
    expect(kekAad("p1", 2)).toBe("anchor/kek/v1|p1|2");
    expect(secretAad({ projectId: "p", environmentId: "e", secretId: "s", version: 3 })).toBe(
      "anchor/secret/v1|p|e|s|3",
    );
  });
});

describe("project KEK wrapping", () => {
  it("wrap then unwrap yields a working key", async () => {
    const root = await rootKey();
    const w = await createWrappedKek(root, "p1", 1);
    expect(w).toMatchObject({ projectId: "p1", version: 1, rootKeyId: ROOT_KEY_ID });
    expect(w.wrappedKey.length).toBe(48);
    const kek = await unwrapKek(root, w);
    const sealed = await seal(kek, utf8Encode("payload"), "aad");
    expect(await open(kek, sealed, "aad")).toEqual(utf8Encode("payload"));
  });

  it("unwrap fails for a KEK moved to another project", async () => {
    const root = await rootKey();
    const w = await createWrappedKek(root, "p1", 1);
    const moved: WrappedKek = { ...w, projectId: "p2" };
    await expect(unwrapKek(root, moved)).rejects.toBeInstanceOf(IntegrityError);
  });

  it("unwrap fails for a different version number", async () => {
    const root = await rootKey();
    const w = await createWrappedKek(root, "p1", 1);
    await expect(unwrapKek(root, { ...w, version: 2 })).rejects.toBeInstanceOf(IntegrityError);
  });

  it("unwrap fails under a different root key", async () => {
    const w = await createWrappedKek(await rootKey(), "p1", 1);
    await expect(unwrapKek(await rootKey(), w)).rejects.toBeInstanceOf(IntegrityError);
  });

  it("unwrap fails for unknown rootKeyId", async () => {
    const root = await rootKey();
    const w = await createWrappedKek(root, "p1", 1);
    const err = await unwrapKek(root, { ...w, rootKeyId: "rk9" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IntegrityError);
    expect((err as IntegrityError).fields).toEqual({ projectId: "p1", kekVersion: 1 });
  });
});

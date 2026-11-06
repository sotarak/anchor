import { describe, expect, it } from "vitest";
import { open, seal } from "#src/crypto/aead";
import {
  createWrappedKek,
  DEFAULT_ROOT_KEY_ID,
  getRootKeyring,
  kekAad,
  type RootKeyEnv,
  secretAad,
  unwrapKek,
  type WrappedKek,
} from "#src/crypto/keyring";
import { toBase64, utf8Encode } from "#src/lib/encoding";
import { ConfigError, IntegrityError } from "#src/lib/errors";
import { randomBytes } from "#src/lib/random";

const rootB64 = () => toBase64(randomBytes(32));
const keyring = (env: Partial<RootKeyEnv> = {}) =>
  getRootKeyring({ ANCHOR_ROOT_KEY: rootB64(), ...env });
const configError = async (env: RootKeyEnv): Promise<ConfigError> => {
  const err = await getRootKeyring(env).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ConfigError);
  return err as ConfigError;
};

describe("getRootKeyring", () => {
  it("rejects missing, non-base64, and 16-byte keys with ConfigError", async () => {
    const short = toBase64(randomBytes(16));
    for (const bad of ["", "not-base64-!!", short, `${rootB64()}AA==`]) {
      const err = await configError({ ANCHOR_ROOT_KEY: bad });
      expect(err.message).toBe("ANCHOR_ROOT_KEY must be 32 bytes, base64-encoded");
      if (bad) expect(err.message).not.toContain(bad);
    }
    await configError({} as RootKeyEnv);
  });

  it("defaults the current id to rk1 and has no previous key", async () => {
    const ring = await keyring();
    expect(DEFAULT_ROOT_KEY_ID).toBe("rk1");
    expect(ring.current.id).toBe("rk1");
    expect(ring.previous).toBeNull();
  });

  it("accepts a current id and a previous key with its id", async () => {
    const ring = await keyring({
      ANCHOR_ROOT_KEY_ID: "rk-2026",
      ANCHOR_ROOT_KEY_PREVIOUS: rootB64(),
      ANCHOR_ROOT_KEY_PREVIOUS_ID: "rk1",
    });
    expect(ring.current.id).toBe("rk-2026");
    expect(ring.previous?.id).toBe("rk1");
  });

  it("rejects malformed ids, naming the variable", async () => {
    for (const bad of ["RK1", "rk_1", "", "a".repeat(33)]) {
      const err = await configError({ ANCHOR_ROOT_KEY: rootB64(), ANCHOR_ROOT_KEY_ID: bad });
      expect(err.message).toBe("ANCHOR_ROOT_KEY_ID must match ^[a-z0-9-]{1,32}$");
    }
    const err = await configError({
      ANCHOR_ROOT_KEY: rootB64(),
      ANCHOR_ROOT_KEY_PREVIOUS: rootB64(),
      ANCHOR_ROOT_KEY_PREVIOUS_ID: "Old",
    });
    expect(err.message).toBe("ANCHOR_ROOT_KEY_PREVIOUS_ID must match ^[a-z0-9-]{1,32}$");
  });

  it("a previous key without a previous id is a ConfigError", async () => {
    const previous = rootB64();
    const err = await configError({
      ANCHOR_ROOT_KEY: rootB64(),
      ANCHOR_ROOT_KEY_PREVIOUS: previous,
    });
    expect(err.message).toBe(
      "ANCHOR_ROOT_KEY_PREVIOUS_ID is required when ANCHOR_ROOT_KEY_PREVIOUS is set",
    );
    expect(err.message).not.toContain(previous);
  });

  it("a previous id equal to the current id is a ConfigError", async () => {
    const err = await configError({
      ANCHOR_ROOT_KEY: rootB64(),
      ANCHOR_ROOT_KEY_PREVIOUS: rootB64(),
      ANCHOR_ROOT_KEY_PREVIOUS_ID: "rk1",
    });
    expect(err.message).toBe("ANCHOR_ROOT_KEY_PREVIOUS_ID must differ from ANCHOR_ROOT_KEY_ID");
  });

  it("a malformed previous key is a ConfigError naming the variable only", async () => {
    const err = await configError({
      ANCHOR_ROOT_KEY: rootB64(),
      ANCHOR_ROOT_KEY_PREVIOUS: "short",
      ANCHOR_ROOT_KEY_PREVIOUS_ID: "rk0",
    });
    expect(err.message).toBe("ANCHOR_ROOT_KEY_PREVIOUS must be 32 bytes, base64-encoded");
  });

  it("a previous id without a previous key is ignored (the key was removed after rewrap)", async () => {
    const ring = await keyring({ ANCHOR_ROOT_KEY_PREVIOUS_ID: "rk0" });
    expect(ring.previous).toBeNull();
  });

  it("returns the cached keyring for the same strings and a new one otherwise", async () => {
    const env = { ANCHOR_ROOT_KEY: rootB64() };
    const a = await getRootKeyring(env);
    expect(await getRootKeyring({ ...env })).toBe(a);
    expect(await getRootKeyring({ ...env, ANCHOR_ROOT_KEY_ID: "rk2" })).not.toBe(a);
    expect(await keyring()).not.toBe(a);
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
    const root = await keyring();
    const w = await createWrappedKek(root, "p1", 1);
    expect(w).toMatchObject({ projectId: "p1", version: 1, rootKeyId: "rk1" });
    expect(w.wrappedKey.length).toBe(48);
    const kek = await unwrapKek(root, w);
    const sealed = await seal(kek, utf8Encode("payload"), "aad");
    expect(await open(kek, sealed, "aad")).toEqual(utf8Encode("payload"));
  });

  it("unwrap fails for a KEK moved to another project", async () => {
    const root = await keyring();
    const w = await createWrappedKek(root, "p1", 1);
    const moved: WrappedKek = { ...w, projectId: "p2" };
    await expect(unwrapKek(root, moved)).rejects.toBeInstanceOf(IntegrityError);
  });

  it("unwrap fails for a different version number", async () => {
    const root = await keyring();
    const w = await createWrappedKek(root, "p1", 1);
    await expect(unwrapKek(root, { ...w, version: 2 })).rejects.toBeInstanceOf(IntegrityError);
  });

  it("unwrap fails under a different root key", async () => {
    const w = await createWrappedKek(await keyring(), "p1", 1);
    await expect(unwrapKek(await keyring(), w)).rejects.toBeInstanceOf(IntegrityError);
  });

  it("unwrap fails for unknown rootKeyId", async () => {
    const root = await keyring();
    const w = await createWrappedKek(root, "p1", 1);
    const err = await unwrapKek(root, { ...w, rootKeyId: "rk9" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IntegrityError);
    expect((err as IntegrityError).fields).toEqual({ projectId: "p1", kekVersion: 1 });
  });

  it("wraps with the current key id and unwraps rows of the previous key", async () => {
    const oldB64 = rootB64();
    const before = await getRootKeyring({ ANCHOR_ROOT_KEY: oldB64 });
    const w = await createWrappedKek(before, "p1", 1);
    expect(w.rootKeyId).toBe("rk1");
    const after = await getRootKeyring({
      ANCHOR_ROOT_KEY: rootB64(),
      ANCHOR_ROOT_KEY_ID: "rk2",
      ANCHOR_ROOT_KEY_PREVIOUS: oldB64,
      ANCHOR_ROOT_KEY_PREVIOUS_ID: "rk1",
    });
    expect((await createWrappedKek(after, "p1", 2)).rootKeyId).toBe("rk2");
    const kek = await unwrapKek(after, w);
    const sealed = await seal(kek, utf8Encode("x"), "aad");
    expect(await open(await unwrapKek(before, w), sealed, "aad")).toEqual(utf8Encode("x"));
  });

  it("a row of the previous id fails when the configured previous key is wrong", async () => {
    const w = await createWrappedKek(await keyring(), "p1", 1);
    const wrong = await keyring({
      ANCHOR_ROOT_KEY_ID: "rk2",
      ANCHOR_ROOT_KEY_PREVIOUS: rootB64(),
      ANCHOR_ROOT_KEY_PREVIOUS_ID: "rk1",
    });
    await expect(unwrapKek(wrong, w)).rejects.toBeInstanceOf(IntegrityError);
  });
});

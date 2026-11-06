import { describe, expect, it } from "vitest";
import { createMacosKeychainStore } from "#src/credentials/macos";
import { createNodeSpawner } from "#src/process/spawner";

// Opt-in: touches the real login keychain. Run with ANCHOR_TEST_KEYCHAIN=1 on macOS.
const enabled = process.platform === "darwin" && process.env.ANCHOR_TEST_KEYCHAIN === "1";

describe.skipIf(!enabled)("macOS keychain (real)", () => {
  it("set, get and delete a throwaway credential", async () => {
    const store = createMacosKeychainStore(createNodeSpawner());
    const apiUrl = "https://anchor-test.invalid";
    const cred = { apiUrl, token: "anc_s_realkeychaintest", email: "t@example.test", expiresAt: 1 };
    await store.delete(apiUrl);
    expect(await store.get(apiUrl)).toBeNull();
    await store.set(cred);
    expect(await store.get(apiUrl)).toEqual(cred);
    await store.set({ ...cred, expiresAt: 2 });
    expect((await store.get(apiUrl))?.expiresAt).toBe(2);
    await store.delete(apiUrl);
    expect(await store.get(apiUrl)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { createMacosKeychainStore } from "#src/credentials/macos";
import { encodeCredential } from "#src/credentials/types";
import { CliError } from "#src/errors";
import { fakeSpawner } from "#test/support";

const cred = {
  apiUrl: "https://a.example",
  token: "anc_s_TOKENCANARY",
  email: "a@b.c",
  expiresAt: 5,
};

describe("macOS keychain store", () => {
  it("macOS set passes the token only via stdin", async () => {
    const fake = fakeSpawner();
    await createMacosKeychainStore(fake.spawner).set(cred);
    const [call] = fake.calls;
    expect(call?.cmd).toBe("security");
    expect(call?.args).toEqual(["-i"]);
    expect(JSON.stringify(call?.args)).not.toContain("TOKENCANARY");
    expect(JSON.stringify(call?.args)).not.toContain(encodeCredential(cred));
    expect(call?.input).toBe(
      `add-generic-password -U -s anchor-cli -a "https://a.example" -w "${encodeCredential(cred)}"\n`,
    );
  });

  it("set fails when security reports an error, without echoing the token", async () => {
    const fake = fakeSpawner(() => ({
      code: 1,
      stderr: `add-generic-password: returned 1 ${encodeCredential(cred)}\n`,
    }));
    const e = await createMacosKeychainStore(fake.spawner)
      .set(cred)
      .catch((err: unknown) => err);
    expect(e).toBeInstanceOf(CliError);
    expect((e as CliError).message).not.toContain(encodeCredential(cred));
    expect((e as CliError).message).not.toContain("TOKENCANARY");
  });

  it("macOS get decodes stdout; not-found returns null; other failure throws CliError without the token", async () => {
    const ok = fakeSpawner(() => ({ code: 0, stdout: `${encodeCredential(cred)}\n` }));
    expect(await createMacosKeychainStore(ok.spawner).get("https://a.example")).toEqual(cred);
    expect(ok.calls[0]?.args).toEqual([
      "find-generic-password",
      "-s",
      "anchor-cli",
      "-a",
      "https://a.example",
      "-w",
    ]);

    const missing = fakeSpawner(() => ({
      code: 44,
      stderr: "security: SecKeychainSearchCopyNext: The specified item could not be found.\n",
    }));
    expect(await createMacosKeychainStore(missing.spawner).get("https://a.example")).toBeNull();

    const broken = fakeSpawner(() => ({
      code: 51,
      stderr: "security: User interaction is not allowed.\nmore detail\n",
    }));
    const e = await createMacosKeychainStore(broken.spawner)
      .get("https://a.example")
      .catch((err: unknown) => err);
    expect(e).toBeInstanceOf(CliError);
    expect((e as CliError).message).toBe(
      "Could not read the macOS keychain: security: User interaction is not allowed.",
    );
  });

  it("delete treats not-found as success", async () => {
    const fake = fakeSpawner(() => ({ code: 44 }));
    await createMacosKeychainStore(fake.spawner).delete("https://a.example");
    expect(fake.calls[0]?.args).toEqual([
      "delete-generic-password",
      "-s",
      "anchor-cli",
      "-a",
      "https://a.example",
    ]);
  });
});

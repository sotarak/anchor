import { describe, expect, it } from "vitest";
import { createSecretServiceStore } from "#src/credentials/linux";
import { encodeCredential } from "#src/credentials/types";
import { CliError } from "#src/errors";
import { fakeSpawner } from "#test/support";

const cred = {
  apiUrl: "https://a.example",
  token: "anc_s_TOKENCANARY",
  email: "a@b.c",
  expiresAt: 5,
};

describe("Secret Service store", () => {
  it("linux set passes the token only via stdin", async () => {
    const fake = fakeSpawner();
    await createSecretServiceStore(fake.spawner).set(cred);
    const [call] = fake.calls;
    expect(call?.cmd).toBe("secret-tool");
    expect(call?.args).toEqual([
      "store",
      "--label",
      "Anchor CLI (https://a.example)",
      "service",
      "anchor-cli",
      "account",
      "https://a.example",
    ]);
    expect(JSON.stringify(call?.args)).not.toContain("TOKENCANARY");
    expect(JSON.stringify(call?.args)).not.toContain(encodeCredential(cred));
    expect(call?.input).toBe(encodeCredential(cred));
  });

  it("lookup exit 1 returns null; exit 0 decodes; other failures throw", async () => {
    const missing = fakeSpawner(() => ({ code: 1 }));
    expect(await createSecretServiceStore(missing.spawner).get("https://a.example")).toBeNull();
    expect(missing.calls[0]?.args).toEqual([
      "lookup",
      "service",
      "anchor-cli",
      "account",
      "https://a.example",
    ]);
    const ok = fakeSpawner(() => ({ code: 0, stdout: encodeCredential(cred) }));
    expect(await createSecretServiceStore(ok.spawner).get("https://a.example")).toEqual(cred);
    const broken = fakeSpawner(() => ({ code: 1, stderr: "Cannot autolaunch D-Bus\n" }));
    await expect(createSecretServiceStore(broken.spawner).get("https://a.example")).rejects.toThrow(
      CliError,
    );
  });

  it("delete clears the item", async () => {
    const fake = fakeSpawner();
    await createSecretServiceStore(fake.spawner).delete("https://a.example");
    expect(fake.calls[0]?.args).toEqual([
      "clear",
      "service",
      "anchor-cli",
      "account",
      "https://a.example",
    ]);
  });
});

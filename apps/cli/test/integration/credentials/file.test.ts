import { chmod, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFileStore } from "#src/credentials/file";
import { selectCredentialStore } from "#src/credentials/select";
import { CliError } from "#src/errors";
import { Output } from "#src/output";
import { createTestIo, fakeSpawner, tmpDir } from "#test/support";

const a = { apiUrl: "https://a.example", token: "anc_s_a", email: "a@b.c", expiresAt: 5 };
const b = { apiUrl: "https://b.example", token: "anc_s_b", email: "b@b.c", expiresAt: 6 };

async function store() {
  const dir = join(await tmpDir(), "anchor");
  const path = join(dir, "credentials.json");
  const io = createTestIo();
  const out = new Output(io, { json: false, quiet: false, noColor: true, debug: false });
  return { dir, path, io, store: createFileStore(path, out) };
}

describe("file credential store", () => {
  it.skipIf(process.platform === "win32")(
    "file store round-trips, writes mode 0600, dir 0700",
    async () => {
      const s = await store();
      expect(await s.store.get(a.apiUrl)).toBeNull();
      await s.store.set(a);
      expect(await s.store.get(a.apiUrl)).toEqual(a);
      expect((await stat(s.path)).mode & 0o777).toBe(0o600);
      expect((await stat(s.dir)).mode & 0o777).toBe(0o700);
      expect(s.store.kind).toBe("file");
      expect(s.io.err()).toBe(
        `warning: No OS keychain available; credentials stored in ${s.path} (mode 0600)\n`,
      );
      await s.store.set(b);
      expect(s.io.err().match(/warning/g)).toHaveLength(1);
    },
  );

  it.skipIf(process.platform === "win32")(
    "file store refuses to read a 0644 credentials file",
    async () => {
      const s = await store();
      await s.store.set(a);
      await chmod(s.path, 0o644);
      const e = await s.store.get(a.apiUrl).catch((err: unknown) => err);
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).message).toBe(`${s.path} is accessible by other users`);
      expect((e as CliError).hint).toBe(`Run 'chmod 600 ${s.path}'`);
    },
  );

  it("file store keeps credentials for two origins independently; delete removes one", async () => {
    const s = await store();
    await s.store.set(a);
    await s.store.set(b);
    await s.store.delete(a.apiUrl);
    expect(await s.store.get(a.apiUrl)).toBeNull();
    expect(await s.store.get(b.apiUrl)).toEqual(b);
    await s.store.delete("https://never.example");
  });

  it("ignores a corrupt entry instead of returning it", async () => {
    const s = await store();
    await s.store.set(a);
    await writeFile(
      s.path,
      JSON.stringify({ version: 1, credentials: { [a.apiUrl]: { token: 1 } } }),
      { mode: 0o600 },
    );
    expect(await s.store.get(a.apiUrl)).toBeNull();
  });

  it.skipIf(process.platform === "win32")(
    "an explicit ANCHOR_CREDENTIAL_STORE=file stores quietly; a missing keychain still warns",
    async () => {
      const chosen = createTestIo({
        platform: "darwin",
        env: { ANCHOR_CREDENTIAL_STORE: "file", XDG_CONFIG_HOME: await tmpDir() },
      });
      const outChosen = new Output(chosen, {
        json: false,
        quiet: false,
        noColor: true,
        debug: false,
      });
      const explicit = await selectCredentialStore(chosen, {
        spawner: fakeSpawner().spawner,
        out: outChosen,
      });
      await explicit.set(a);
      expect(await explicit.get(a.apiUrl)).toEqual(a);
      expect(chosen.err()).toBe("");

      // No keychain on this platform: the fallback is not the user's choice, so it still warns.
      const fallback = createTestIo({
        platform: "linux",
        env: { XDG_CONFIG_HOME: await tmpDir() },
      });
      const outFallback = new Output(fallback, {
        json: false,
        quiet: false,
        noColor: true,
        debug: false,
      });
      const auto = await selectCredentialStore(fallback, {
        spawner: fakeSpawner().spawner,
        out: outFallback,
      });
      await auto.set(a);
      expect(fallback.err()).toMatch(/^warning: No OS keychain available; credentials stored in /);
    },
  );
});

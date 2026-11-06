import { describe, expect, it } from "vitest";
import { selectCredentialStore } from "#src/credentials/select";
import { Output } from "#src/output";
import { createTestIo, fakeSpawner } from "#test/support";

const outFor = (io: ReturnType<typeof createTestIo>) =>
  new Output(io, { json: false, quiet: false, noColor: true, debug: false });

describe("selectCredentialStore", () => {
  it("selectCredentialStore honors ANCHOR_CREDENTIAL_STORE=file; picks file on win32; falls back to file when security is missing", async () => {
    const forced = createTestIo({ platform: "darwin", env: { ANCHOR_CREDENTIAL_STORE: "file" } });
    const any = fakeSpawner();
    expect(
      (await selectCredentialStore(forced, { spawner: any.spawner, out: outFor(forced) })).kind,
    ).toBe("file");
    expect(any.calls).toEqual([]);

    const win = createTestIo({ platform: "win32", env: { APPDATA: "C:\\x" } });
    expect(
      (await selectCredentialStore(win, { spawner: any.spawner, out: outFor(win) })).kind,
    ).toBe("file");

    const mac = createTestIo({ platform: "darwin" });
    const noSecurity = fakeSpawner(() => "ENOENT");
    expect(
      (await selectCredentialStore(mac, { spawner: noSecurity.spawner, out: outFor(mac) })).kind,
    ).toBe("file");
    const withSecurity = fakeSpawner();
    expect(
      (await selectCredentialStore(mac, { spawner: withSecurity.spawner, out: outFor(mac) })).kind,
    ).toBe("macos-keychain");
  });

  it("linux uses secret-tool only with a D-Bus session and the binary present", async () => {
    const dbus = createTestIo({
      platform: "linux",
      env: { DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1/bus" },
    });
    const present = fakeSpawner(() => ({ code: 0 }));
    expect(
      (await selectCredentialStore(dbus, { spawner: present.spawner, out: outFor(dbus) })).kind,
    ).toBe("secret-service");
    const absent = fakeSpawner(() => "ENOENT");
    expect(
      (await selectCredentialStore(dbus, { spawner: absent.spawner, out: outFor(dbus) })).kind,
    ).toBe("file");
    const headless = createTestIo({ platform: "linux" });
    expect(
      (await selectCredentialStore(headless, { spawner: present.spawner, out: outFor(headless) }))
        .kind,
    ).toBe("file");
  });

  it("falls back to the file store with a warning when the keychain set fails", async () => {
    const { tmpDir } = await import("#test/support");
    const io = createTestIo({ platform: "darwin", env: { XDG_CONFIG_HOME: await tmpDir() } });
    const failing = fakeSpawner((call) =>
      call.args[0] === "-i"
        ? { code: 1, stderr: "add-generic-password: returned 1\n" }
        : { code: 44 },
    );
    const store = await selectCredentialStore(io, { spawner: failing.spawner, out: outFor(io) });
    const cred = { apiUrl: "https://a.example", token: "anc_s_x", email: "a@b.c", expiresAt: 5 };
    await store.set(cred);
    expect(store.kind).toBe("file");
    expect(io.err()).toContain("warning: Could not write to the macOS keychain");
    expect(await store.get("https://a.example")).toEqual(cred);
  });
});

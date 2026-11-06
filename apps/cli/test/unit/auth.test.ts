import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { authedApi, resolveAuth } from "#src/auth";
import { CliError, EXIT } from "#src/errors";
import { apiError, createTestIo, fakeApi, memoryStore, testContext, tmpDir } from "#test/support";

const API = "https://anchor.example";
const future = Date.now() + 3_600_000;
const stored = { apiUrl: API, token: "anc_s_stored", email: "a@b.c", expiresAt: future };

async function io(env: Record<string, string> = {}) {
  const dir = await tmpDir();
  return createTestIo({ cwd: dir, env: { XDG_CONFIG_HOME: join(dir, "xdg"), ...env } });
}

async function failure(p: Promise<unknown>): Promise<CliError> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(CliError);
  return e as CliError;
}

describe("resolveAuth", () => {
  it("resolveAuth prefers ANCHOR_TOKEN over stored credential", async () => {
    const ctx = await testContext(await io({ ANCHOR_API_URL: API, ANCHOR_TOKEN: "anc_st_env" }));
    expect(await resolveAuth(ctx, memoryStore([stored]).store)).toEqual({
      apiUrl: API,
      token: "anc_st_env",
      source: "ANCHOR_TOKEN",
    });
    const noEnv = await testContext(await io({ ANCHOR_API_URL: API }));
    expect(await resolveAuth(noEnv, memoryStore([stored]).store)).toEqual({
      apiUrl: API,
      token: "anc_s_stored",
      source: "stored",
    });
  });

  it("resolveAuth refuses ANCHOR_TOKEN when the API URL came only from .anchor.json", async () => {
    const t = await io({ ANCHOR_TOKEN: "anc_st_env" });
    await writeFile(
      join(t.cwd, ".anchor.json"),
      JSON.stringify({ version: 1, project: "app", apiUrl: "https://evil.example" }),
    );
    const e = await failure(resolveAuth(await testContext(t), memoryStore().store));
    expect([e.exitCode, e.message, e.hint]).toEqual([
      EXIT.USAGE,
      "ANCHOR_TOKEN is only sent to an API URL from --api-url, ANCHOR_API_URL or your user config",
      "Set ANCHOR_API_URL",
    ]);
    // A flag or ANCHOR_API_URL makes the target explicit again.
    const ok = await testContext(t, { apiUrl: API });
    expect((await resolveAuth(ok, memoryStore().store)).apiUrl).toBe(API);
  });

  it("resolveAuth: no credential -> exit 3 with login hint; expired stored session -> exit 3", async () => {
    const ctx = await testContext(await io({ ANCHOR_API_URL: API }));
    const missing = await failure(resolveAuth(ctx, memoryStore().store));
    expect([missing.exitCode, missing.message, missing.hint]).toEqual([
      EXIT.AUTH,
      `Not logged in to ${API}`,
      "Run 'anchor login' or set ANCHOR_TOKEN",
    ]);
    const expired = await failure(
      resolveAuth(ctx, memoryStore([{ ...stored, expiresAt: Date.now() - 1 }]).store),
    );
    expect([expired.exitCode, expired.message, expired.hint]).toEqual([
      EXIT.AUTH,
      "Your session has expired",
      "Run 'anchor login'",
    ]);
  });

  it("no API URL -> exit 2 with a configuration hint", async () => {
    const e = await failure(resolveAuth(await testContext(await io()), memoryStore().store));
    expect([e.exitCode, e.message, e.hint]).toEqual([
      EXIT.USAGE,
      "No API URL configured",
      "Run 'anchor login --api-url https://...' or set ANCHOR_API_URL",
    ]);
  });
});

describe("authedApi", () => {
  it("builds a client for the resolved origin and token and maps API errors", async () => {
    const fake = fakeApi({ me: async () => Promise.reject(apiError(401, "unauthenticated")) });
    const mem = memoryStore([stored]);
    const ctx = await testContext(
      await io({ ANCHOR_API_URL: API }),
      {},
      {
        createApi: fake.factory,
        selectStore: mem.selectStore,
      },
    );
    const { api, auth } = await authedApi(ctx);
    expect(auth).toEqual({ apiUrl: API, source: "stored" });
    expect(fake.clients).toEqual([{ baseUrl: API, token: "anc_s_stored" }]);
    const e = await failure(api.me());
    expect([e.exitCode, e.message]).toEqual([EXIT.AUTH, "Your session has expired or was revoked"]);
  });
});

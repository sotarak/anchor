import { env } from "cloudflare:workers";
import type { SecretDto } from "@anchor/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "#src/app";
import { toBase64 } from "#src/lib/encoding";
import { randomBytes } from "#src/lib/random";
import {
  auditRows,
  createUserWithSession,
  json,
  jsonInit,
  resetDb,
  TEST_ORIGIN,
} from "#test/support";

const app = createApp();
const OLD_KEY = env.ANCHOR_ROOT_KEY;
const NEW_KEY = toBase64(randomBytes(32));
const ROTATED = {
  ANCHOR_ROOT_KEY: NEW_KEY,
  ANCHOR_ROOT_KEY_ID: "rk2",
  ANCHOR_ROOT_KEY_PREVIOUS: OLD_KEY,
  ANCHOR_ROOT_KEY_PREVIOUS_ID: "rk-test",
};
const NEW_ONLY = { ANCHOR_ROOT_KEY: NEW_KEY, ANCHOR_ROOT_KEY_ID: "rk2" };

let owner: string;
const METHODS = ["log", "info", "warn", "error", "debug"] as const;
let spies: ReturnType<typeof vi.spyOn>[] = [];
const logs = () =>
  spies
    .flatMap((s) => s.mock.calls)
    .map((args: unknown[]) =>
      args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "),
    )
    .join("\n");

/** Sends a request through the app with the test bindings plus `overrides`. */
function call(path: string, init: RequestInit, overrides: Record<string, string> = {}) {
  return app.request(TEST_ORIGIN + path, init, { ...env, ...overrides });
}
const bearer = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
const readSecret = (overrides: Record<string, string> = {}) =>
  call("/api/v1/projects/app/environments/dev/secrets/K", bearer(owner), overrides);
const rewrap = (overrides: Record<string, string>, t = owner) =>
  call("/api/v1/admin/root-key/rewrap", jsonInit("POST", {}, { token: t }), overrides);
const rootKeyIds = async () =>
  (
    await env.DB.prepare("SELECT root_key_id FROM project_keys ORDER BY project_id, version").all<{
      root_key_id: string;
    }>()
  ).results.map((r) => r.root_key_id);
const wrappedKeys = async () =>
  JSON.stringify((await env.DB.prepare("SELECT * FROM project_keys").all()).results);

beforeEach(async () => {
  await resetDb();
  spies = METHODS.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  ({ token: owner } = await createUserWithSession({ role: "owner", kind: "cli" }));
  for (const slug of ["app", "other"]) {
    const res = await call(
      "/api/v1/projects",
      jsonInit("POST", { slug, name: slug }, { token: owner }),
    );
    expect(res.status).toBe(201);
  }
  const put = await call(
    "/api/v1/projects/app/environments/dev/secrets/K",
    jsonInit("PUT", { value: "before-rotation" }, { token: owner }),
  );
  expect(put.status).toBe(201);
});
afterEach(() => {
  for (const s of spies) s.mockRestore();
});

describe("root keyring", () => {
  it("existing data decrypts after rotation with previous key configured", async () => {
    expect(await rootKeyIds()).toEqual(["rk-test", "rk-test"]);
    const res = await readSecret(ROTATED);
    expect(res.status).toBe(200);
    expect((await json<{ secret: SecretDto }>(res)).secret.value).toBe("before-rotation");
    // New projects are wrapped under the new current key.
    const created = await call(
      "/api/v1/projects",
      jsonInit("POST", { slug: "fresh", name: "Fresh" }, { token: owner }),
      ROTATED,
    );
    expect(created.status).toBe(201);
    expect((await rootKeyIds()).sort()).toEqual(["rk-test", "rk-test", "rk2"]);
  });

  it("rewrap converts all rows and second call returns 0", async () => {
    const first = await rewrap(ROTATED);
    expect(first.status).toBe(200);
    expect(await json(first)).toEqual({ rewrapped: 2 });
    expect(await rootKeyIds()).toEqual(["rk2", "rk2"]);
    const second = await rewrap(ROTATED);
    expect(await json(second)).toEqual({ rewrapped: 0 });
    const [row] = await auditRows("root_key.rewrapped");
    expect(JSON.parse(row?.metadata ?? "null")).toEqual({ count: 2, toKeyId: "rk2" });
  });

  it("after rewrap, previous key can be removed and data still decrypts", async () => {
    expect((await rewrap(ROTATED)).status).toBe(200);
    const res = await readSecret(NEW_ONLY);
    expect(res.status).toBe(200);
    expect((await json<{ secret: SecretDto }>(res)).secret.value).toBe("before-rotation");
    // And the old key alone no longer opens anything.
    expect(
      (await readSecret({ ANCHOR_ROOT_KEY: OLD_KEY, ANCHOR_ROOT_KEY_ID: "rk-test" })).status,
    ).toBe(500);
  });

  it("previous key without previous id -> 500 internal, config_error logged", async () => {
    const res = await readSecret({ ...NEW_ONLY, ANCHOR_ROOT_KEY_PREVIOUS: OLD_KEY });
    expect(res.status).toBe(500);
    expect((await json<{ error: { code: string } }>(res)).error.code).toBe("internal");
    expect(logs()).toContain("config_error");
    expect((await rewrap({ ...NEW_ONLY, ANCHOR_ROOT_KEY_PREVIOUS: OLD_KEY })).status).toBe(500);
  });

  it("previous id equal to current id -> 500", async () => {
    const res = await rewrap({ ...ROTATED, ANCHOR_ROOT_KEY_PREVIOUS_ID: "rk2" });
    expect(res.status).toBe(500);
    expect(logs()).toContain("config_error");
    expect(await rootKeyIds()).toEqual(["rk-test", "rk-test"]);
  });

  it("wrong previous key -> rewrap 500, secret_decrypt_failed logged, zero rows changed", async () => {
    const before = await wrappedKeys();
    const res = await rewrap({ ...ROTATED, ANCHOR_ROOT_KEY_PREVIOUS: toBase64(randomBytes(32)) });
    expect(res.status).toBe(500);
    expect(logs()).toContain("secret_decrypt_failed");
    expect(await wrappedKeys()).toBe(before);
  });

  it("rows under an unconfigured root key id: rewrap and new projects fail closed", async () => {
    const before = await wrappedKeys();
    const res = await rewrap(NEW_ONLY);
    expect(res.status).toBe(500);
    expect(await wrappedKeys()).toBe(before);
    const created = await call(
      "/api/v1/projects",
      jsonInit("POST", { slug: "split", name: "Split" }, { token: owner }),
      NEW_ONLY,
    );
    expect(created.status).toBe(500);
    expect(logs()).toContain("config_error");
  });

  it("unknown root_key_id on a row -> IntegrityError on read", async () => {
    await env.DB.prepare("UPDATE project_keys SET root_key_id = 'rk-zzz'").run();
    const res = await readSecret();
    expect(res.status).toBe(500);
    expect(logs()).toContain("secret_decrypt_failed");
  });

  it("non-owner admin -> 403", async () => {
    const admin = await createUserWithSession({ role: "admin", kind: "cli" });
    expect((await rewrap(ROTATED, admin.token)).status).toBe(403);
    expect(await rootKeyIds()).toEqual(["rk-test", "rk-test"]);
  });

  it("response and logs never contain base64 key material", async () => {
    const responses = [
      await rewrap(ROTATED),
      await rewrap({ ...ROTATED, ANCHOR_ROOT_KEY_PREVIOUS: "bm90LWEta2V5" }),
      await readSecret({ ...NEW_ONLY, ANCHOR_ROOT_KEY_PREVIOUS: OLD_KEY }),
    ];
    const bodies = (await Promise.all(responses.map((r) => r.text()))).join("\n");
    for (const key of [OLD_KEY, NEW_KEY, "bm90LWEta2V5"]) {
      expect(bodies).not.toContain(key);
      expect(logs()).not.toContain(key);
    }
  });
});

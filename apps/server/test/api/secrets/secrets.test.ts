import { env } from "cloudflare:workers";
import type { ApiErrorBody, SecretDto } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "#src/app";
import {
  api,
  createMember,
  createUserWithSession,
  json,
  jsonInit,
  resetDb,
  TEST_ORIGIN,
} from "#test/support";

const BASE = "/api/v1/projects/app/environments/dev/secrets";
let token: string;
let cookie: string;

beforeEach(async () => {
  await resetDb();
  ({ token, cookie } = await createUserWithSession({ role: "owner" }));
  const res = await api(
    "/api/v1/projects",
    jsonInit("POST", { slug: "app", name: "App" }, { token }),
  );
  expect(res.status).toBe(201);
});

const put = (key: string, body: unknown, auth: Parameters<typeof jsonInit>[2] = { token }) =>
  api(`${BASE}/${key}`, jsonInit("PUT", body, auth));
const get = (key: string, query = "", t = token) =>
  api(`${BASE}/${key}${query}`, { headers: { authorization: `Bearer ${t}` } });
const list = (query = "", t = token) =>
  api(`${BASE}${query}`, { headers: { authorization: `Bearer ${t}` } });
const del = (key: string, query = "", t = token) =>
  api(`${BASE}/${key}${query}`, { method: "DELETE", headers: { authorization: `Bearer ${t}` } });

describe("secrets HTTP API", () => {
  it("put then get round-trips over HTTP (bearer)", async () => {
    expect((await put("DB_URL", { value: "postgres://x", comment: "main db" })).status).toBe(201);
    const res = await get("DB_URL");
    expect(res.status).toBe(200);
    const { secret } = await json<{ secret: SecretDto }>(res);
    expect(secret).toMatchObject({
      key: "DB_URL",
      path: "/",
      version: 1,
      comment: "main db",
      value: "postgres://x",
    });
  });

  it("put via cookie without Origin -> 403", async () => {
    const res = await put("K", { value: "v" }, { cookie, origin: null });
    expect(res.status).toBe(403);
    expect((await get("K")).status).toBe(404);
  });

  it("put via cookie with same Origin succeeds", async () => {
    expect((await put("K", { value: "v" }, { cookie })).status).toBe(201);
  });

  it("put returns 201 then 200 and never echoes value", async () => {
    const first = await put("K", { value: "v1" });
    expect(first.status).toBe(201);
    const a = await json<{ secret: SecretDto }>(first);
    expect(a.secret.version).toBe(1);
    expect("value" in a.secret).toBe(false);

    const second = await put("K", { value: "v2" });
    expect(second.status).toBe(200);
    const b = await json<{ secret: SecretDto }>(second);
    expect(b.secret.version).toBe(2);
    expect("value" in b.secret).toBe(false);

    const same = await put("K", { value: "v2" });
    expect(same.status).toBe(200);
    expect((await json<{ secret: SecretDto }>(same)).secret.version).toBe(2);
  });

  it("path spellings api, /api, /api/ address the same secret", async () => {
    expect((await put("K", { value: "v", path: "api" })).status).toBe(201);
    for (const p of ["/api", "/api/", "api"]) {
      const res = await get("K", `?path=${encodeURIComponent(p)}`);
      expect(res.status, p).toBe(200);
      expect((await json<{ secret: SecretDto }>(res)).secret.path).toBe("/api");
    }
    expect((await put("K", { value: "w", path: "/api/" })).status).toBe(200);
    expect((await get("K")).status).toBe(404);
  });

  it("path=/../x -> 400", async () => {
    expect((await get("K", "?path=/../x")).status).toBe(400);
    expect((await put("K", { value: "v", path: "/../x" })).status).toBe(400);
  });

  it("value of 65537 bytes -> 413 payload_too_large", async () => {
    const res = await put("K", { value: "a".repeat(65537) });
    expect(res.status).toBe(413);
    expect((await json<ApiErrorBody>(res)).error.code).toBe("payload_too_large");
    expect((await put("K", { value: "a".repeat(65536) })).status).toBe(201);
  });

  it('invalid key "1BAD" -> 400', async () => {
    expect((await put("1BAD", { value: "v" })).status).toBe(400);
    expect((await get("1BAD")).status).toBe(400);
    expect((await del("1BAD")).status).toBe(400);
  });

  it("list without reveal has no value field; with reveal=true has values", async () => {
    await put("B", { value: "bee" });
    await put("A", { value: "ay" });
    await put("C", { value: "nested", path: "/sub" });

    const hidden = await json<{ secrets: SecretDto[] }>(await list());
    expect(hidden.secrets.map((s) => s.key)).toEqual(["A", "B"]);
    for (const s of hidden.secrets) expect("value" in s).toBe(false);

    const shown = await json<{ secrets: SecretDto[] }>(await list("?reveal=true"));
    expect(shown.secrets.map((s) => s.value)).toEqual(["ay", "bee"]);

    const sub = await json<{ secrets: SecretDto[] }>(await list("?path=/sub&reveal=true"));
    expect(sub.secrets.map((s) => [s.key, s.value])).toEqual([["C", "nested"]]);
  });

  it("delete removes the secret -> 204 then 404", async () => {
    await put("K", { value: "v" });
    expect((await del("K")).status).toBe(204);
    expect((await get("K")).status).toBe(404);
    expect((await del("K")).status).toBe(404);
  });

  it("member without membership -> 403 on read and write", async () => {
    await put("K", { value: "v" });
    const member = await createUserWithSession({ role: "member" });
    const t = member.token;
    expect((await list("", t)).status).toBe(403);
    expect((await get("K", "", t)).status).toBe(403);
    expect((await put("K", { value: "x" }, { token: t })).status).toBe(403);
    expect((await del("K", "", t)).status).toBe(403);
    expect(
      (await json<{ secret: SecretDto }>(await get("K"))).secret.value,
      "member write must not land",
    ).toBe("v");
  });

  it("members get role- and environment-appropriate access", async () => {
    await put("K", { value: "v" });
    const viewer = await createMember("app", { role: "viewer" });
    expect((await get("K", "", viewer.token)).status).toBe(200);
    expect((await list("?reveal=true", viewer.token)).status).toBe(200);
    expect((await put("K", { value: "x" }, { token: viewer.token })).status).toBe(403);
    expect((await del("K", "", viewer.token)).status).toBe(403);

    const prodOnly = await createMember("app", { role: "developer", environments: ["prod"] });
    expect((await get("K", "", prodOnly.token)).status).toBe(403);
    expect((await put("K", { value: "x" }, { token: prodOnly.token })).status).toBe(403);

    const dev = await createMember("app", { role: "developer", environments: ["dev"] });
    expect((await put("K", { value: "from-dev" }, { token: dev.token })).status).toBe(200);
    expect((await get("K", "", dev.token)).status).toBe(200);
  });

  it("no auth -> 401", async () => {
    expect((await api(BASE)).status).toBe(401);
    expect((await api(`${BASE}/K`)).status).toBe(401);
    expect((await put("K", { value: "v" }, {})).status).toBe(401);
    expect((await api(`${BASE}/K`, { method: "DELETE" })).status).toBe(401);
    expect((await api(`${BASE}/1BAD?path=/../x`)).status, "auth before validation").toBe(401);
  });

  it("unknown project/env/key -> 404", async () => {
    const h = { headers: { authorization: `Bearer ${token}` } };
    const cases: [string, string][] = [
      ["/api/v1/projects/nope/environments/dev/secrets", "Project not found"],
      ["/api/v1/projects/app/environments/nope/secrets", "Environment not found"],
      [`${BASE}/MISSING`, "Secret not found"],
    ];
    for (const [url, message] of cases) {
      const res = await api(url, h);
      expect(res.status, url).toBe(404);
      expect((await json<ApiErrorBody>(res)).error.message).toBe(message);
    }
  });

  it("malformed ANCHOR_ROOT_KEY -> 500 internal on get, body has no key material", async () => {
    await put("K", { value: "v" });
    const badKey = "not-a-valid-root-key-material-zzz";
    const app = createApp();
    const res = await app.request(
      `${TEST_ORIGIN}${BASE}/K`,
      { headers: { authorization: `Bearer ${token}` } },
      { ...env, ANCHOR_ROOT_KEY: badKey },
    );
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: { code: "internal", message: "Internal error" } });
    expect(text).not.toContain(badKey);
    expect(text).not.toContain(env.ANCHOR_ROOT_KEY);
  });
});

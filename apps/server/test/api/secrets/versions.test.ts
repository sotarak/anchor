import { env } from "cloudflare:workers";
import type { SecretDto, SecretVersionDto } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createWrappedKek, getRootKeyring } from "#src/crypto/keyring";
import {
  api,
  auditRows,
  createMember,
  createUserWithSession,
  json,
  jsonInit,
  resetDb,
} from "#test/support";

const base = (e = "dev") => `/api/v1/projects/app/environments/${e}/secrets`;
let owner: { userId: string; token: string };

const bearer = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
const put = (key: string, value: string, comment = "", t = owner.token, e = "dev") =>
  api(`${base(e)}/${key}`, jsonInit("PUT", { value, comment, path: "/" }, { token: t }));
const versions = (key: string, t = owner.token, e = "dev") =>
  api(`${base(e)}/${key}/versions?path=%2F`, bearer(t));
const version = (key: string, v: string | number, t = owner.token, e = "dev") =>
  api(`${base(e)}/${key}/versions/${v}?path=%2F`, bearer(t));
const rollback = (key: string, v: number, t = owner.token) =>
  api(`${base()}/${key}/rollback`, jsonInit("POST", { path: "/", version: v }, { token: t }));
const current = async (key: string) =>
  (await json<{ secret: SecretDto }>(await api(`${base()}/${key}`, bearer(owner.token)))).secret;

beforeEach(async () => {
  await resetDb();
  owner = await createUserWithSession({ role: "owner", kind: "cli", email: "owner@example.test" });
  const res = await api(
    "/api/v1/projects",
    jsonInit("POST", { slug: "app", name: "App" }, { token: owner.token }),
  );
  expect(res.status).toBe(201);
});

describe("secret versions", () => {
  it("lists versions newest first without values", async () => {
    await put("K", "one", "first");
    await put("K", "two", "second");
    const res = await versions("K");
    expect(res.status).toBe(200);
    const body = await json<{ versions: SecretVersionDto[] }>(res);
    expect(body.versions.map((v) => [v.version, v.comment])).toEqual([
      [2, "second"],
      [1, "first"],
    ]);
    expect(body.versions[0]?.createdBy).toEqual({ id: owner.userId, label: "owner@example.test" });
    expect(typeof body.versions[0]?.createdAt).toBe("number");
    expect(JSON.stringify(body)).not.toMatch(/one|two"/);
    expect(body.versions[0]).not.toHaveProperty("value");
  });

  it("unknown secret -> 404", async () => {
    expect((await versions("NOPE")).status).toBe(404);
  });

  it("reveals a past version byte-exact", async () => {
    const tricky = "multi\nline ✓ \u0000 tail ";
    await put("K", tricky, "c1");
    await put("K", "later");
    const res = await version("K", 1);
    expect(res.status).toBe(200);
    const { version: v } = await json<{ version: SecretVersionDto & { value: string } }>(res);
    expect(v).toMatchObject({ version: 1, comment: "c1", value: tricky });
  });

  it("rollback creates version n+1 equal to the old value and comment", async () => {
    await put("K", "one", "first");
    await put("K", "two", "second");
    const res = await rollback("K", 1);
    expect(res.status).toBe(200);
    const { secret, changed } = await json<{ secret: SecretDto; changed: boolean }>(res);
    expect(changed).toBe(true);
    expect(secret).toMatchObject({ key: "K", version: 3, comment: "first" });
    expect(secret).not.toHaveProperty("value");
    expect(await current("K")).toMatchObject({ version: 3, value: "one", comment: "first" });
  });

  it("rollback to current content is a no-op 200 with no new row", async () => {
    await put("K", "one", "first");
    await put("K", "two", "second");
    await put("K", "one", "first");
    const res = await rollback("K", 1);
    expect(res.status).toBe(200);
    const body = await json<{ secret: SecretDto; changed: boolean }>(res);
    expect(body).toMatchObject({ secret: { version: 3 }, changed: false });
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM secret_versions").first<{
      n: number;
    }>();
    expect(rows?.n).toBe(3);
    expect(await auditRows("secret.rolled_back")).toEqual([]);
  });

  it("rolled-back version decrypts after its source version row is deleted", async () => {
    await put("K", "one");
    await put("K", "two");
    expect((await rollback("K", 1)).status).toBe(200);
    await env.DB.prepare("DELETE FROM secret_versions WHERE version = 1").run();
    expect((await current("K")).value).toBe("one");
  });

  it("past version encrypted under an older KEK still reveals", async () => {
    await put("K", "under-kek-1");
    const project = await env.DB.prepare("SELECT id FROM projects WHERE slug = 'app'").first<{
      id: string;
    }>();
    const w = await createWrappedKek(await getRootKeyring(env), project?.id ?? "", 2);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO project_keys (project_id, version, root_key_id, iv, wrapped_key, created_at) VALUES (?, 2, ?, ?, ?, 0)",
      ).bind(w.projectId, w.rootKeyId, w.iv, w.wrappedKey),
      env.DB.prepare("UPDATE projects SET current_key_version = 2 WHERE id = ?").bind(w.projectId),
    ]);
    await put("K", "under-kek-2");
    const keyVersions = await env.DB.prepare(
      "SELECT version, key_version FROM secret_versions ORDER BY version",
    ).all<{ version: number; key_version: number }>();
    expect(keyVersions.results).toEqual([
      { version: 1, key_version: 1 },
      { version: 2, key_version: 2 },
    ]);
    const { version: v } = await json<{ version: { value: string } }>(await version("K", 1));
    expect(v.value).toBe("under-kek-1");
  });

  it("unknown version -> 404, version 0 / abc -> 400", async () => {
    await put("K", "one");
    const missing = await version("K", 7);
    expect(missing.status).toBe(404);
    expect((await json<{ error: { message: string } }>(missing)).error.message).toBe(
      "Version not found",
    );
    expect((await version("K", 0)).status).toBe(400);
    expect((await version("K", "abc")).status).toBe(400);
    expect((await rollback("K", 0)).status).toBe(400);
    expect((await rollback("K", 9)).status).toBe(404);
  });

  it("viewer can list and reveal but not rollback (403)", async () => {
    await put("K", "one");
    await put("K", "two");
    const viewer = await createMember("app", { role: "viewer" });
    expect((await versions("K", viewer.token)).status).toBe(200);
    expect((await version("K", 1, viewer.token)).status).toBe(200);
    expect((await rollback("K", 1, viewer.token)).status).toBe(403);
  });

  it("dev-only member cannot reveal prod history (403)", async () => {
    await put("K", "prod-value", "", owner.token, "prod");
    const dev = await createMember("app", { role: "developer", environments: ["dev"] });
    expect((await versions("K", dev.token, "prod")).status).toBe(403);
    expect((await version("K", 1, dev.token, "prod")).status).toBe(403);
  });

  it("audit has secret.version_read and secret.rolled_back without the value", async () => {
    await put("K", "VALUE-CANARY-1");
    await put("K", "VALUE-CANARY-2");
    await version("K", 1);
    await rollback("K", 1);
    const [read] = await auditRows("secret.version_read");
    expect(JSON.parse(read?.metadata ?? "null")).toEqual({ path: "/", key: "K", version: 1 });
    const [rolled] = await auditRows("secret.rolled_back");
    expect(JSON.parse(rolled?.metadata ?? "null")).toEqual({
      path: "/",
      key: "K",
      fromVersion: 2,
      toVersion: 1,
      newVersion: 3,
    });
    const all = JSON.stringify(await auditRows());
    expect(all).not.toContain("VALUE-CANARY");
  });
});

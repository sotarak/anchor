import { env } from "cloudflare:workers";
import type { ApiErrorBody } from "@anchor/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "#src/app";
import {
  type AuditRow,
  api,
  auditRows,
  createServiceToken,
  createUserWithSession,
  failingAuditDb,
  json,
  jsonInit,
  resetDb,
  TEST_ORIGIN,
  TEST_PASSWORD,
} from "#test/support";

const CANARY = "AUDIT-CANARY-51e2";
const CANARY_2 = "AUDIT-CANARY-2";
const bearer = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
const secrets = (rest = "") => `/api/v1/projects/app/environments/dev/secrets${rest}`;
const meta = (r: AuditRow | undefined) => JSON.parse(r?.metadata ?? "null") as unknown;
const login = (email: string, password: string) =>
  api("/api/v1/auth/login", jsonInit("POST", { email, password, client: "cli" }));

let owner: { userId: string; token: string };
const put = (key: string, value: string, path = "/") =>
  api(secrets(`/${key}`), jsonInit("PUT", { value, path }, { token: owner.token }));

beforeEach(async () => {
  await resetDb();
  owner = await createUserWithSession({ role: "owner", kind: "cli", email: "owner@example.test" });
});

async function createAppProject() {
  const res = await api(
    "/api/v1/projects",
    jsonInit("POST", { name: "App", slug: "app" }, { token: owner.token }),
  );
  expect(res.status).toBe(201);
  return (await json<{ project: { id: string } }>(res)).project.id;
}

describe("auth events", () => {
  it("setup is audited with the new owner as actor", async () => {
    await resetDb();
    const res = await createApp().request(
      `${TEST_ORIGIN}/api/v1/setup`,
      jsonInit("POST", {
        email: "First@Example.test",
        name: "First",
        password: TEST_PASSWORD,
      }),
      env,
    );
    expect(res.status).toBe(201);
    const { user } = await json<{ user: { id: string } }>(res);
    const [row] = await auditRows("auth.setup");
    expect(row).toMatchObject({
      actor_type: "user",
      actor_id: user.id,
      actor_label: "first@example.test",
    });
  });

  it("login success and failure are audited; failure label is the submitted email", async () => {
    expect((await login("owner@example.test", TEST_PASSWORD)).status).toBe(200);
    expect((await login("OWNER@example.test", "wrong password!!")).status).toBe(401);
    expect((await login("Ghost@Example.test", "wrong password!!")).status).toBe(401);
    const [ok] = await auditRows("auth.login");
    expect(ok).toMatchObject({
      actor_type: "user",
      actor_id: owner.userId,
      actor_label: "owner@example.test",
    });
    expect(meta(ok)).toEqual({ client: "cli" });
    const failed = await auditRows("auth.login_failed");
    expect(failed.map((r) => [r.actor_type, r.actor_id, r.actor_label, meta(r)])).toEqual([
      ["anonymous", null, "owner@example.test", { reason: "invalid_credentials" }],
      ["anonymous", null, "ghost@example.test", { reason: "invalid_credentials" }],
    ]);
    const all = JSON.stringify(await env.DB.prepare("SELECT * FROM audit_events").all());
    expect(all).not.toContain("wrong password!!");
    expect(all).not.toContain(TEST_PASSWORD);
  });

  it("locked login is audited with reason locked", async () => {
    for (let i = 0; i < 5; i++) await login("owner@example.test", "wrong password!!");
    expect((await login("owner@example.test", TEST_PASSWORD)).status).toBe(429);
    const failed = await auditRows("auth.login_failed");
    expect(failed.map((r) => meta(r))).toEqual([
      ...Array(5).fill({ reason: "invalid_credentials" }),
      { reason: "locked" },
    ]);
  });

  it("disabled login is audited with reason disabled", async () => {
    await env.DB.prepare("UPDATE users SET disabled_at = ? WHERE id = ?")
      .bind(Date.now(), owner.userId)
      .run();
    expect((await login("owner@example.test", TEST_PASSWORD)).status).toBe(403);
    expect((await auditRows("auth.login_failed")).map((r) => meta(r))).toEqual([
      { reason: "disabled" },
    ]);
  });

  it("logout is audited only when a session was presented", async () => {
    expect((await api("/api/v1/auth/logout", { method: "POST" })).status).toBe(204);
    expect(await auditRows("auth.logout")).toEqual([]);
    expect(
      (await api("/api/v1/auth/logout", { method: "POST", ...bearer(owner.token) })).status,
    ).toBe(204);
    const rows = await auditRows("auth.logout");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_type: "user", actor_id: owner.userId });
  });
});

describe("project and environment events", () => {
  it("project and environment lifecycle events are recorded with ids", async () => {
    const projectId = await createAppProject();
    const opts = { token: owner.token };
    await api("/api/v1/projects/app", jsonInit("PATCH", { name: "Renamed" }, opts));
    const envRes = await api(
      "/api/v1/projects/app/environments",
      jsonInit("POST", { name: "QA", slug: "qa" }, opts),
    );
    const envId = (await json<{ environment: { id: string } }>(envRes)).environment.id;
    await api("/api/v1/projects/app/environments/qa", jsonInit("PATCH", { name: "Quality" }, opts));
    await api("/api/v1/projects/app/environments/qa", jsonInit("DELETE", undefined, opts));
    await api("/api/v1/projects/app", jsonInit("DELETE", undefined, opts));

    const rows = (await auditRows()).filter((r) => /^(project|environment)\./.test(r.action));
    expect(rows.map((r) => [r.action, r.project_id, r.environment_id, meta(r)])).toEqual([
      ["project.created", projectId, null, { slug: "app", name: "App" }],
      ["project.updated", projectId, null, { slug: "app", name: "Renamed" }],
      ["environment.created", projectId, envId, { slug: "qa", name: "QA" }],
      ["environment.updated", projectId, envId, { slug: "qa", name: "Quality" }],
      ["environment.deleted", projectId, envId, { slug: "qa", name: "Quality" }],
      ["project.deleted", projectId, null, { slug: "app", name: "Renamed" }],
    ]);
    for (const r of rows) expect(r.actor_id).toBe(owner.userId);
  });

  it("failed actions are not audited", async () => {
    await createAppProject();
    expect(
      (
        await api(
          "/api/v1/projects",
          jsonInit("POST", { name: "Dup", slug: "app" }, { token: owner.token }),
        )
      ).status,
    ).toBe(409);
    expect(await auditRows("project.created")).toHaveLength(1);
  });
});

describe("secret events", () => {
  it("secret write is audited once; identical put is not audited", async () => {
    await createAppProject();
    expect((await put("DB_URL", "one", "/api")).status).toBe(201);
    expect((await put("DB_URL", "one", "/api")).status).toBe(200);
    expect((await put("DB_URL", "two", "/api")).status).toBe(200);
    const created = await auditRows("secret.created");
    const updated = await auditRows("secret.updated");
    expect(created.map(meta)).toEqual([{ path: "/api", key: "DB_URL", version: 1 }]);
    expect(updated.map(meta)).toEqual([{ path: "/api", key: "DB_URL", version: 2 }]);
    expect(created[0]?.environment_id).not.toBeNull();
    expect(created[0]?.target).toBe("DB_URL");
    await api(
      secrets("/DB_URL?path=%2Fapi"),
      jsonInit("DELETE", undefined, { token: owner.token }),
    );
    expect((await auditRows("secret.deleted")).map(meta)).toEqual([
      { path: "/api", key: "DB_URL" },
    ]);
  });

  it("secret.read audited for reveal list and single get, not for plain list", async () => {
    await createAppProject();
    await put("A", "1");
    await put("B", "2");
    expect((await api(secrets("?path=%2F"), bearer(owner.token))).status).toBe(200);
    expect(await auditRows("secret.read")).toEqual([]);
    expect((await api(secrets("?path=%2F&reveal=true"), bearer(owner.token))).status).toBe(200);
    expect((await api(secrets("/A?path=%2F"), bearer(owner.token))).status).toBe(200);
    const reads = await auditRows("secret.read");
    expect(reads.map((r) => [r.target, meta(r)])).toEqual([
      [null, { path: "/", keys: ["A", "B"] }],
      ["A", { path: "/", keys: ["A"] }],
    ]);
  });

  it("a reveal list of a large folder is audited (key names capped by bytes), not a 500", async () => {
    await createAppProject();
    const keys = Array.from(
      { length: 400 },
      (_, i) => `K${String(i).padStart(3, "0")}_${"X".repeat(40)}`,
    );
    for (const key of keys) expect((await put(key, "v")).status).toBe(201);
    const res = await api(secrets("?reveal=true"), bearer(owner.token));
    expect(res.status).toBe(200);
    expect((await json<{ secrets: unknown[] }>(res)).secrets).toHaveLength(400);
    const [row] = await auditRows("secret.read");
    const metadata = meta(row) as { path: string; keys: string[]; keysTruncated?: true };
    expect(metadata.keysTruncated).toBe(true);
    expect(metadata.keys.length).toBeGreaterThan(100);
    expect(metadata.keys).toEqual(keys.slice(0, metadata.keys.length));
    expect(new TextEncoder().encode(row?.metadata ?? "").byteLength).toBeLessThanOrEqual(16_384);
  }, 60_000); // 400 real encrypted writes: well over the 5 s default on CI runners.

  it("service-token reads are audited with actor service_token and its name", async () => {
    await createAppProject();
    await put("A", "1");
    const { token, id } = await createServiceToken("app", {
      name: "ci-reader",
      permission: "read",
      scopes: [{ environment: "dev", path: "/" }],
    });
    expect((await api(secrets("/A"), bearer(token))).status).toBe(200);
    const [row] = await auditRows("secret.read");
    expect(row).toMatchObject({
      actor_type: "service_token",
      actor_id: id,
      actor_label: "ci-reader",
    });
  });

  it("audit rows never contain the value canary", async () => {
    await createAppProject();
    await put("CANARY", CANARY);
    await put("CANARY", CANARY_2);
    await api(secrets("/CANARY"), bearer(owner.token));
    await api(secrets("?reveal=true"), bearer(owner.token));
    await api(secrets("/CANARY"), jsonInit("DELETE", undefined, { token: owner.token }));
    expect((await auditRows()).length).toBeGreaterThanOrEqual(5);
    const all = JSON.stringify((await env.DB.prepare("SELECT * FROM audit_events").all()).results);
    expect(all).not.toContain(CANARY);
    expect(all).not.toContain(CANARY_2);
  });

  it("secret read fails closed when audit insert fails", async () => {
    await createAppProject();
    await put("CANARY", CANARY);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failing = { ...env, DB: failingAuditDb(env.DB) };
      for (const path of [secrets("/CANARY"), secrets("?reveal=true")]) {
        const res = await createApp().request(TEST_ORIGIN + path, bearer(owner.token), failing);
        expect(res.status).toBe(500);
        const text = await res.text();
        expect((JSON.parse(text) as ApiErrorBody).error.code).toBe("internal");
        expect(text).not.toContain(CANARY);
      }
    } finally {
      errors.mockRestore();
    }
  });

  it("500 from audit failure logs unhandled_error without the value", async () => {
    await createAppProject();
    await put("CANARY", CANARY);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await createApp().request(TEST_ORIGIN + secrets("/CANARY"), bearer(owner.token), {
        ...env,
        DB: failingAuditDb(env.DB),
      });
      expect(res.status).toBe(500);
      const logged = errors.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
      expect(logged).toContain("unhandled_error");
      expect(logged).not.toContain(CANARY);
      expect(logged).not.toContain(owner.token);
    } finally {
      errors.mockRestore();
    }
  });
});

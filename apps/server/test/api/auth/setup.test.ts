import { env } from "cloudflare:workers";
import type { ApiErrorBody, LoginResponse, SetupStatusDto } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "#src/app";
import { api, json, jsonInit, resetDb, TEST_ORIGIN } from "#test/support";

const body = (overrides: Record<string, unknown> = {}) => ({
  email: "Owner@Example.io",
  name: "Owner",
  password: "correct horse battery staple",
  ...overrides,
});
const setup = (b: unknown) => api("/api/v1/setup", jsonInit("POST", b));
const login = (email: string, password: string) =>
  api("/api/v1/auth/login", jsonInit("POST", { email, password }));
const userCount = async () =>
  (await env.DB.prepare("SELECT count(*) AS n FROM users").first<{ n: number }>())?.n;

beforeEach(resetDb);

describe("setup", () => {
  it("status reports needsSetup true on empty db and false after setup", async () => {
    const before = await json<SetupStatusDto>(await api("/api/v1/setup/status"));
    expect(before).toEqual({ needsSetup: true });
    expect((await setup(body())).status).toBe(201);
    const after = await json<SetupStatusDto>(await api("/api/v1/setup/status"));
    expect(after).toEqual({ needsSetup: false });
  });

  it("setup needs no token: it creates an owner, sets the cookie and the cookie works on /auth/me", async () => {
    const res = await setup(body());
    expect(res.status).toBe(201);
    const data = await json<LoginResponse>(res);
    expect(data.user).toMatchObject({ email: "owner@example.io", name: "Owner", role: "owner" });
    expect(data.token).toBeUndefined();
    expect(data.expiresAt).toBeGreaterThan(Date.now());
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^__Host-anchor_session=anc_s_/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    const cookie = setCookie.split(";")[0] ?? "";
    const me = await api("/api/v1/auth/me", { headers: { cookie } });
    expect(me.status).toBe(200);
  });

  it("works on a Worker with no ANCHOR_SETUP_TOKEN and ignores one that is still set", async () => {
    for (const token of [undefined, "", "left-over-secret-from-0.2"]) {
      await resetDb();
      const res = await createApp().request(
        `${TEST_ORIGIN}/api/v1/setup`,
        jsonInit("POST", body()),
        { ...env, ANCHOR_SETUP_TOKEN: token },
      );
      expect(res.status, `ANCHOR_SETUP_TOKEN=${String(token)}`).toBe(201);
    }
  });

  it("a body that still carries setupToken (older clients) is accepted and the field ignored", async () => {
    const res = await setup(body({ setupToken: "anything at all" }));
    expect(res.status).toBe(201);
    expect(await userCount()).toBe(1);
  });

  it("second setup -> 409 and the first owner keeps their email and password", async () => {
    await setup(body());
    const res = await setup(
      body({ email: "Owner@Example.io", name: "Intruder", password: "another long password" }),
    );
    expect(res.status).toBe(409);
    expect((await json<ApiErrorBody>(res)).error).toEqual({
      code: "conflict",
      message: "Instance already set up",
    });
    expect(res.headers.get("set-cookie")).toBeNull();
    const rows = await env.DB.prepare("SELECT email, name FROM users").all();
    expect(rows.results).toEqual([{ email: "owner@example.io", name: "Owner" }]);
    expect((await login("owner@example.io", "correct horse battery staple")).status).toBe(200);
    expect((await login("owner@example.io", "another long password")).status).toBe(401);
  });

  it("concurrent setups create exactly one owner", async () => {
    const results = await Promise.all(
      ["a@example.io", "b@example.io", "c@example.io"].map((email) => setup(body({ email }))),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await userCount()).toBe(1);
  });

  it("invalid input -> 400 and no user", async () => {
    for (const bad of [
      body({ password: "short" }),
      body({ email: "not-an-email" }),
      body({ name: "" }),
      {},
    ]) {
      expect((await setup(bad)).status).toBe(400);
    }
    expect(await userCount()).toBe(0);
  });

  it("email is stored lowercased", async () => {
    await setup(body());
    const row = await env.DB.prepare("SELECT email FROM users").first<{ email: string }>();
    expect(row?.email).toBe("owner@example.io");
  });
});

import { env } from "cloudflare:workers";
import type { ApiErrorBody, LoginResponse, SetupStatusDto } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { api, json, jsonInit, resetDb, TEST_ORIGIN } from "./helpers";

const SETUP_TOKEN = "test-setup-token-0123456789abcdef";
const body = (overrides: Record<string, unknown> = {}) => ({
  setupToken: SETUP_TOKEN,
  email: "Owner@Example.io",
  name: "Owner",
  password: "correct horse battery staple",
  ...overrides,
});
const setup = (b: unknown) => api("/api/v1/setup", jsonInit("POST", b));
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

  it("setup creates an owner, sets the cookie and the cookie works on /auth/me", async () => {
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

  it("wrong setup token -> 403 and no user created", async () => {
    const res = await setup(body({ setupToken: "test-setup-token-0123456789abcdeX" }));
    expect(res.status).toBe(403);
    expect((await json<ApiErrorBody>(res)).error).toEqual({
      code: "forbidden",
      message: "Invalid setup token",
    });
    expect(await userCount()).toBe(0);
  });

  it("setup token of different length -> 403", async () => {
    for (const setupToken of ["x", `${SETUP_TOKEN}-longer`]) {
      expect((await setup(body({ setupToken }))).status).toBe(403);
    }
    expect(await userCount()).toBe(0);
  });

  it("missing ANCHOR_SETUP_TOKEN -> 503 setup_disabled even with a body", async () => {
    for (const disabled of [undefined, ""]) {
      const app = createApp();
      const res = await app.request(`${TEST_ORIGIN}/api/v1/setup`, jsonInit("POST", body()), {
        ...env,
        ANCHOR_SETUP_TOKEN: disabled,
      });
      expect(res.status).toBe(503);
      expect((await json<ApiErrorBody>(res)).error.code).toBe("setup_disabled");
    }
    expect(await userCount()).toBe(0);
  });

  it("second setup -> 409 and the first owner is unchanged", async () => {
    await setup(body());
    const res = await setup(body({ email: "intruder@evil.io", password: "another long password" }));
    expect(res.status).toBe(409);
    expect((await json<ApiErrorBody>(res)).error).toEqual({
      code: "conflict",
      message: "Instance already set up",
    });
    const rows = await env.DB.prepare("SELECT email FROM users").all<{ email: string }>();
    expect(rows.results.map((r) => r.email)).toEqual(["owner@example.io"]);
  });

  it("weak password -> 400 and no user", async () => {
    const res = await setup(body({ password: "short" }));
    expect(res.status).toBe(400);
    expect(await userCount()).toBe(0);
  });

  it("email is stored lowercased", async () => {
    await setup(body());
    const row = await env.DB.prepare("SELECT email FROM users").first<{ email: string }>();
    expect(row?.email).toBe("owner@example.io");
  });
});

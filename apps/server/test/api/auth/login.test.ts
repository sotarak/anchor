import { env } from "cloudflare:workers";
import type { ApiErrorBody, LoginResponse } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { api, createUserWithSession, json, jsonInit, resetDb, TEST_PASSWORD } from "#test/support";

const EMAIL = "dev@example.io";
const login = (b: Record<string, unknown>) => api("/api/v1/auth/login", jsonInit("POST", b));
const state = () =>
  env.DB.prepare("SELECT failed_logins, locked_until FROM users WHERE email = ?")
    .bind(EMAIL)
    .first<{ failed_logins: number; locked_until: number | null }>();

beforeEach(async () => {
  await resetDb();
  await createUserWithSession({ email: EMAIL });
});

describe("POST /auth/login", () => {
  it("web login sets the cookie and no token", async () => {
    const res = await login({ email: EMAIL, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    const data = await json<LoginResponse>(res);
    expect(data.user.email).toBe(EMAIL);
    expect(data.token).toBeUndefined();
    expect(res.headers.get("set-cookie")).toMatch(/^__Host-anchor_session=anc_s_/);
  });

  it("cli login returns a token usable as bearer", async () => {
    const res = await login({ email: EMAIL, password: TEST_PASSWORD, client: "cli" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    const data = await json<LoginResponse>(res);
    expect(data.token).toMatch(/^anc_s_/);
    expect(data.expiresAt - Date.now()).toBeGreaterThan(29 * 86_400_000);
    const me = await api("/api/v1/auth/me", { headers: { authorization: `Bearer ${data.token}` } });
    expect(me.status).toBe(200);
  });

  it("wrong password and unknown email return identical status and body", async () => {
    const a = await login({ email: EMAIL, password: "wrong password!!" });
    const b = await login({ email: "nobody@example.io", password: "wrong password!!" });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    const expected = {
      error: { code: "invalid_credentials", message: "Invalid email or password" },
    };
    expect(await json<ApiErrorBody>(a)).toEqual(expected);
    expect(await json<ApiErrorBody>(b)).toEqual(expected);
  });

  it("email lookup is case-insensitive", async () => {
    const res = await login({ email: "DEV@Example.IO", password: TEST_PASSWORD });
    expect(res.status).toBe(200);
  });

  it("5 failures lock the account; correct password then gets 429", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await login({ email: EMAIL, password: `wrong-${i}-password` })).status).toBe(401);
    }
    const res = await login({ email: EMAIL, password: TEST_PASSWORD });
    expect(res.status).toBe(429);
    expect((await json<ApiErrorBody>(res)).error).toEqual({
      code: "rate_limited",
      message: "Too many failed attempts, try again later",
    });
    expect((await state())?.locked_until).toBeGreaterThan(Date.now());
  });

  it("attempts while locked do not change the lock state", async () => {
    for (let i = 0; i < 5; i++) await login({ email: EMAIL, password: `wrong-${i}-password` });
    const before = await state();
    await login({ email: EMAIL, password: "still wrong pw" });
    expect(await state()).toEqual(before);
  });

  it("after lockout expires, the correct password works", async () => {
    for (let i = 0; i < 5; i++) await login({ email: EMAIL, password: `wrong-${i}-password` });
    await env.DB.prepare("UPDATE users SET locked_until = ? WHERE email = ?")
      .bind(Date.now() - 1, EMAIL)
      .run();
    expect((await login({ email: EMAIL, password: TEST_PASSWORD })).status).toBe(200);
  });

  it("successful login resets failed_logins to 0", async () => {
    await login({ email: EMAIL, password: "wrong password 1" });
    await login({ email: EMAIL, password: "wrong password 2" });
    expect((await state())?.failed_logins).toBe(2);
    await login({ email: EMAIL, password: TEST_PASSWORD });
    expect(await state()).toEqual({ failed_logins: 0, locked_until: null });
  });

  it("invalid body -> 400", async () => {
    expect((await login({ email: "not-an-email", password: "x" })).status).toBe(400);
    expect((await login({ email: EMAIL, password: TEST_PASSWORD, client: "mobile" })).status).toBe(
      400,
    );
  });
});

describe("lockout under concurrency", () => {
  it("parallel wrong logins cannot exceed 5 guesses per lock", async () => {
    const attempts = Array.from({ length: 20 }, (_, i) =>
      login({ email: EMAIL, password: `wrong password number ${i}` }),
    );
    const statuses = (await Promise.all(attempts)).map((r) => r.status);
    expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(5);
    expect(statuses.filter((s) => s !== 401 && s !== 429)).toEqual([]);
    expect((await login({ email: EMAIL, password: TEST_PASSWORD })).status).toBe(429);
  });

  it("a correct password still resets after concurrent failures below the limit", async () => {
    await Promise.all(
      [0, 1, 2].map((i) => login({ email: EMAIL, password: `wrong password number ${i}` })),
    );
    expect((await state())?.failed_logins).toBe(3);
    expect((await login({ email: EMAIL, password: TEST_PASSWORD })).status).toBe(200);
    expect(await state()).toEqual({ failed_logins: 0, locked_until: null });
  });
});

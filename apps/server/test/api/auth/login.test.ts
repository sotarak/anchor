import { env } from "cloudflare:workers";
import type { ApiErrorBody, LoginResponse } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  api,
  auditRows,
  createUserWithSession,
  json,
  jsonInit,
  resetDb,
  TEST_PASSWORD,
} from "#test/support";

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

  it("password login records method password", async () => {
    expect((await login({ email: EMAIL, password: TEST_PASSWORD, client: "cli" })).status).toBe(
      200,
    );
    const [event] = await auditRows("auth.login");
    expect(JSON.parse(event?.metadata ?? "null")).toEqual({ client: "cli", method: "password" });
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

  it("invalid body -> 400", async () => {
    expect((await login({ email: "not-an-email", password: "x" })).status).toBe(400);
    expect((await login({ email: EMAIL, password: TEST_PASSWORD, client: "mobile" })).status).toBe(
      400,
    );
  });
});

const A = "198.51.100.7";
const B = "203.0.113.9";
const LOCKED = { code: "rate_limited", message: "Too many failed attempts, try again later" };
const loginFrom = (ip: string, b: Record<string, unknown>) => {
  const init = jsonInit("POST", b);
  (init.headers as Record<string, string>)["cf-connecting-ip"] = ip;
  return api("/api/v1/auth/login", init);
};
const wrong = (ip: string, email = EMAIL, n = 0) =>
  loginFrom(ip, { email, password: `wrong-${n}-password` });
const attemptRow = (key: string) =>
  env.DB.prepare("SELECT failures, locked_until FROM login_attempts WHERE key = ?")
    .bind(key)
    .first<{ failures: number; locked_until: number | null }>();

describe("login limit per address and email", () => {
  it("5 failures from one address lock that pair; the correct password then gets 429", async () => {
    for (let i = 0; i < 5; i++) expect((await wrong(A, EMAIL, i)).status).toBe(401);
    const res = await loginFrom(A, { email: EMAIL, password: TEST_PASSWORD });
    expect(res.status).toBe(429);
    expect((await json<ApiErrorBody>(res)).error).toEqual(LOCKED);
  });

  it("the same email still logs in from another address (an attacker cannot lock the owner out)", async () => {
    for (let i = 0; i < 6; i++) await wrong(A, EMAIL, i);
    expect((await loginFrom(B, { email: EMAIL, password: TEST_PASSWORD })).status).toBe(200);
  });

  it("an unknown email locks exactly like a known one (no enumeration)", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await wrong(A, "nobody@example.io", i)).status).toBe(401);
      await wrong(B, EMAIL, i);
    }
    const unknown = await wrong(A, "nobody@example.io", 9);
    const known = await wrong(B, EMAIL, 9);
    expect(unknown.status).toBe(429);
    expect(known.status).toBe(429);
    expect(await json<ApiErrorBody>(unknown)).toEqual(await json<ApiErrorBody>(known));
  });

  it("a success clears the pair", async () => {
    for (let i = 0; i < 4; i++) await wrong(A, EMAIL, i);
    expect((await loginFrom(A, { email: EMAIL, password: TEST_PASSWORD })).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await wrong(A, EMAIL, i)).status).toBe(401);
  });

  it("50 failures from one address lock it for every email; another address is unaffected", async () => {
    for (let i = 0; i < 50; i++) {
      expect((await wrong(A, `user${i}@example.io`)).status).toBe(401);
    }
    expect((await wrong(A, "user50@example.io")).status).toBe(429);
    expect((await loginFrom(A, { email: EMAIL, password: TEST_PASSWORD })).status).toBe(429);
    expect((await loginFrom(B, { email: EMAIL, password: TEST_PASSWORD })).status).toBe(200);
  });

  it("IPv6 addresses in one /64 share a counter", async () => {
    for (let i = 0; i < 5; i++) await wrong(i % 2 ? "2001:db8::1" : "2001:db8::2", EMAIL, i);
    expect(
      (await loginFrom("2001:db8::99", { email: EMAIL, password: TEST_PASSWORD })).status,
    ).toBe(429);
  });

  it("after the lock expires, the correct password works", async () => {
    for (let i = 0; i < 5; i++) await wrong(A, EMAIL, i);
    await env.DB.prepare("UPDATE login_attempts SET locked_until = ?")
      .bind(Date.now() - 1)
      .run();
    expect((await loginFrom(A, { email: EMAIL, password: TEST_PASSWORD })).status).toBe(200);
  });

  it("attempts while locked are not counted", async () => {
    for (let i = 0; i < 5; i++) await wrong(A, EMAIL, i);
    const before = await attemptRow(`p|${A}|${EMAIL}`);
    expect(before?.locked_until).toBeGreaterThan(Date.now());
    await wrong(A, EMAIL, 7);
    expect(await attemptRow(`p|${A}|${EMAIL}`)).toEqual(before);
  });

  it("login never locks the account itself", async () => {
    for (let i = 0; i < 6; i++) await wrong(A, EMAIL, i);
    expect(await state()).toEqual({ failed_logins: 0, locked_until: null });
  });

  it("a 429 is audited as login_failed with reason locked", async () => {
    for (let i = 0; i < 6; i++) await wrong(A, EMAIL, i);
    const rows = await auditRows("auth.login_failed");
    expect(JSON.parse(rows.at(-1)?.metadata ?? "null")).toEqual({ reason: "locked" });
  });
});

describe("login limit under concurrency", () => {
  it("parallel wrong logins from one address cannot exceed 5 guesses per lock", async () => {
    const attempts = Array.from({ length: 20 }, (_, i) => wrong(A, EMAIL, i));
    const statuses = (await Promise.all(attempts)).map((r) => r.status);
    expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(5);
    expect(statuses.filter((s) => s !== 401 && s !== 429)).toEqual([]);
    expect((await loginFrom(A, { email: EMAIL, password: TEST_PASSWORD })).status).toBe(429);
  });
});

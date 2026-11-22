import { env } from "cloudflare:workers";
import type { ApiErrorBody, LoginResponse, MfaRequiredResponse } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  api,
  auditRows,
  createUserWithSession,
  enableTotp,
  giveRecoveryCodes,
  json,
  jsonInit,
  resetDb,
  TEST_PASSWORD,
} from "#test/support";

const EMAIL = "mfa@example.io";
let userId: string;
let codeAt: (nowMs: number) => Promise<string>;

const login = (client: "web" | "cli" = "web") =>
  api("/api/v1/auth/login", jsonInit("POST", { email: EMAIL, password: TEST_PASSWORD, client }));
const second = (ticket: string, method: "totp" | "recovery", code: string) =>
  api("/api/v1/auth/login/mfa", jsonInit("POST", { ticket, method, code }));
async function ticketFor(client: "web" | "cli" = "web"): Promise<MfaRequiredResponse> {
  const res = await login(client);
  expect(res.status).toBe(200);
  return json<MfaRequiredResponse>(res);
}
const sessionCount = async () =>
  (
    await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?")
      .bind(userId)
      .first<{ n: number }>()
  )?.n;
const errorOf = async (res: Response) => (await json<ApiErrorBody>(res)).error;
const EXPIRED = { code: "unauthenticated", message: "Sign-in expired, start again" };
const INVALID = { code: "invalid_credentials", message: "Invalid authentication code" };

beforeEach(async () => {
  await resetDb();
  ({ userId } = await createUserWithSession({ email: EMAIL }));
  await env.DB.prepare("DELETE FROM sessions").run();
  ({ codeAt } = await enableTotp(userId));
});

describe("POST /auth/login with MFA", () => {
  it("answers with a ticket instead of a session", async () => {
    const res = await login();
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    const body = await json<MfaRequiredResponse>(res);
    expect(body).toMatchObject({ mfaRequired: true, methods: ["totp", "recovery"] });
    expect(body.ticket).toMatch(/^anc_mfa_/);
    expect(body.expiresAt - Date.now()).toBeGreaterThan(290_000);
    expect(await sessionCount()).toBe(0);
    expect(await auditRows("auth.login")).toEqual([]);
  });

  it("the ticket is not a credential", async () => {
    const { ticket } = await ticketFor();
    const me = await api("/api/v1/auth/me", { headers: { authorization: `Bearer ${ticket}` } });
    expect(me.status).toBe(401);
  });

  it("a wrong password still says nothing about MFA", async () => {
    const res = await api(
      "/api/v1/auth/login",
      jsonInit("POST", { email: EMAIL, password: "wrong password!!" }),
    );
    expect(res.status).toBe(401);
  });
});

describe("POST /auth/login/mfa", () => {
  it("a right TOTP code signs a web login in with a cookie, once", async () => {
    const { ticket } = await ticketFor("web");
    const res = await second(ticket, "totp", await codeAt(Date.now()));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/^__Host-anchor_session=anc_s_/);
    const body = await json<LoginResponse>(res);
    expect(body.user.email).toBe(EMAIL);
    expect(body.token).toBeUndefined();
    const [event] = await auditRows("auth.login");
    expect(JSON.parse(event?.metadata ?? "null")).toEqual({
      client: "web",
      method: "password+totp",
    });
    expect(await errorOf(await second(ticket, "totp", await codeAt(Date.now())))).toEqual(EXPIRED);
  });

  it("a code typed as the app shows it (123 456) signs in", async () => {
    const { ticket } = await ticketFor("web");
    const code = await codeAt(Date.now());
    const res = await second(ticket, "totp", `${code.slice(0, 3)} ${code.slice(3)}`);
    expect(res.status).toBe(200);
  });

  it("a cli ticket returns a bearer token", async () => {
    const { ticket } = await ticketFor("cli");
    const res = await second(ticket, "totp", await codeAt(Date.now()));
    expect(res.headers.get("set-cookie")).toBeNull();
    expect((await json<LoginResponse>(res)).token).toMatch(/^anc_s_/);
  });

  it("a wrong code is refused and audited; the fifth kills the ticket", async () => {
    const { ticket } = await ticketFor();
    const res = await second(ticket, "totp", "000000");
    expect(res.status).toBe(401);
    expect(await errorOf(res)).toEqual(INVALID);
    const [failed] = await auditRows("auth.login_failed");
    expect(JSON.parse(failed?.metadata ?? "null")).toEqual({ reason: "mfa_invalid" });
    expect(failed?.actor_label).toBe(EMAIL);
    for (let i = 0; i < 3; i++) await second(ticket, "totp", "000000");
    // The factor limit is 5 per account, so the 5th wrong code is counted then the ticket dies.
    await second(ticket, "totp", "000000");
    await env.DB.prepare("DELETE FROM login_attempts").run();
    expect(await errorOf(await second(ticket, "totp", await codeAt(Date.now())))).toEqual(EXPIRED);
  });

  it("five wrong codes across tickets lock the second step for the account", async () => {
    for (let i = 0; i < 5; i++) {
      const { ticket } = await ticketFor();
      expect((await second(ticket, "totp", "000000")).status).toBe(401);
    }
    const { ticket } = await ticketFor();
    const locked = await second(ticket, "totp", await codeAt(Date.now()));
    expect(locked.status).toBe(429);
    expect(await errorOf(locked)).toEqual({
      code: "rate_limited",
      message: "Too many failed attempts, try again later",
    });
    const reasons = (await auditRows("auth.login_failed")).map(
      (r) => JSON.parse(r.metadata).reason,
    );
    expect(reasons.at(-1)).toBe("mfa_locked");
    expect(await sessionCount()).toBe(0);
    // Once the lock has passed, the right code works.
    await env.DB.prepare("UPDATE login_attempts SET locked_until = 1 WHERE key LIKE 'm|%'").run();
    expect((await second(ticket, "totp", await codeAt(Date.now()))).status).toBe(200);
  });

  it("a recovery code typed loosely works once and reports what is left", async () => {
    const [code] = await giveRecoveryCodes(userId);
    if (!code) throw new Error("no code");
    const loose = ` ${code.toUpperCase().replace("-", " ")} `;
    const { ticket } = await ticketFor();
    expect((await second(ticket, "recovery", loose)).status).toBe(200);
    const [event] = await auditRows("auth.login");
    expect(JSON.parse(event?.metadata ?? "null")).toEqual({
      client: "web",
      method: "password+recovery",
      recoveryCodesRemaining: 9,
    });
    const again = await ticketFor();
    expect(await errorOf(await second(again.ticket, "recovery", code))).toEqual(INVALID);
  });

  it("a user disabled between the steps gets no session", async () => {
    const { ticket } = await ticketFor();
    await env.DB.prepare("UPDATE users SET disabled_at = 1 WHERE id = ?").bind(userId).run();
    expect(await errorOf(await second(ticket, "totp", await codeAt(Date.now())))).toEqual(EXPIRED);
    expect(await sessionCount()).toBe(0);
  });

  it("an expired ticket gets no session", async () => {
    const { ticket } = await ticketFor();
    await env.DB.prepare("UPDATE mfa_tickets SET expires_at = 1").run();
    expect(await errorOf(await second(ticket, "totp", await codeAt(Date.now())))).toEqual(EXPIRED);
  });

  it("the same valid code on two tickets at once yields exactly one session", async () => {
    const [a, b] = [await ticketFor(), await ticketFor()];
    const code = await codeAt(Date.now());
    const results = await Promise.all([
      second(a.ticket, "totp", code),
      second(b.ticket, "totp", code),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(await sessionCount()).toBe(1);
  });

  it("an unknown ticket is refused like an expired one", async () => {
    expect(await errorOf(await second("anc_mfa_unknown", "totp", "123456"))).toEqual(EXPIRED);
  });
});

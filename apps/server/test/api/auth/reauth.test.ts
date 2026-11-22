import { env } from "cloudflare:workers";
import type { ApiErrorBody, MfaStatusDto } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  api,
  auditRows,
  createUserWithSession,
  enablePasskey,
  enableTotp,
  giveRecoveryCodes,
  json,
  jsonInit,
  mfaCall,
  resetDb,
  type SoftAuthenticator,
  staleReauth,
  TEST_PASSWORD,
} from "#test/support";

let userId: string;
let cookie: string;
const reauth = (body: unknown) => mfaCall("POST", "/auth/reauth", cookie, body);
const status = async () => json<MfaStatusDto>(await mfaCall("GET", "/auth/mfa", cookie));
const errorOf = async (res: Response) => (await json<ApiErrorBody>(res)).error;

beforeEach(async () => {
  await resetDb();
  ({ userId, cookie } = await createUserWithSession());
  await staleReauth(userId);
});

describe("POST /auth/reauth without MFA", () => {
  it("the password refreshes the step-up window", async () => {
    expect((await status()).reauthUntil).toBeNull();
    const res = await reauth({ method: "password", password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    const { reauthUntil } = await json<{ reauthUntil: number }>(res);
    expect(reauthUntil - Date.now()).toBeGreaterThan(590_000);
    expect((await status()).reauthUntil).toBe(reauthUntil);
    const [event] = await auditRows("auth.reauth");
    expect(JSON.parse(event?.metadata ?? "null")).toEqual({ method: "password" });
  });

  it("a wrong password is 401 and the fifth wrong one locks", async () => {
    const res = await reauth({ method: "password", password: "nope nope nope" });
    expect(await errorOf(res)).toEqual({
      code: "invalid_credentials",
      message: "Password is incorrect",
    });
    for (let i = 0; i < 4; i++) await reauth({ method: "password", password: "nope nope nope" });
    expect((await reauth({ method: "password", password: TEST_PASSWORD })).status).toBe(429);
  });

  it("a code is refused while MFA is off", async () => {
    expect(await errorOf(await reauth({ method: "totp", code: "123456" }))).toEqual({
      code: "bad_request",
      message: "Confirm with your password",
    });
  });
});

describe("POST /auth/reauth with MFA", () => {
  let codeAt: (nowMs: number) => Promise<string>;
  beforeEach(async () => {
    ({ codeAt } = await enableTotp(userId));
  });

  it("the password is not enough", async () => {
    expect(await errorOf(await reauth({ method: "password", password: TEST_PASSWORD }))).toEqual({
      code: "bad_request",
      message: "Confirm with your authenticator app, a passkey or a recovery code",
    });
  });

  it("a TOTP code or a recovery code works", async () => {
    expect((await reauth({ method: "totp", code: await codeAt(Date.now()) })).status).toBe(200);
    await staleReauth(userId);
    const [code] = await giveRecoveryCodes(userId);
    expect((await reauth({ method: "recovery", code })).status).toBe(200);
    const methods = (await auditRows("auth.reauth")).map((r) => JSON.parse(r.metadata).method);
    expect(methods).toEqual(["totp", "recovery"]);
  });

  it("wrong codes count toward the account's factor limit", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await reauth({ method: "totp", code: "000000" })).status).toBe(401);
    }
    expect((await reauth({ method: "totp", code: await codeAt(Date.now()) })).status).toBe(429);
  });
});

describe("who may re-authenticate", () => {
  it("a cli session and a service-token-like bearer are refused", async () => {
    const cli = await createUserWithSession({ kind: "cli" });
    const res = await mfaCall("POST", "/auth/reauth", `__Host-anchor_session=${cli.token}`, {
      method: "password",
      password: TEST_PASSWORD,
    });
    expect(res.status).toBe(403);
  });

  it("a cookie request without Origin is refused (CSRF)", async () => {
    const res = await api(
      "/api/v1/auth/reauth",
      jsonInit("POST", { method: "password", password: TEST_PASSWORD }, { cookie, origin: null }),
    );
    expect(res.status).toBe(403);
    const row = await env.DB.prepare("SELECT reauth_at FROM sessions WHERE user_id = ?")
      .bind(userId)
      .first<{ reauth_at: number }>();
    expect(Date.now() - (row?.reauth_at ?? 0)).toBeGreaterThan(600_000);
  });
});

describe("passkey step-up", () => {
  let auth: SoftAuthenticator;
  beforeEach(async () => {
    auth = await enablePasskey(userId);
  });

  async function passkeyReauth(o?: { tamper?: boolean }) {
    const res = await mfaCall("POST", "/auth/reauth/passkey/options", cookie);
    const { options } = await json<{ options: { challenge: string } }>(res);
    return mfaCall("POST", "/auth/reauth/passkey", cookie, {
      response: await auth.authenticate(options, o),
    });
  }

  it("a passkey assertion refreshes the window", async () => {
    const res = await passkeyReauth();
    expect(res.status).toBe(200);
    expect((await json<{ reauthUntil: number }>(res)).reauthUntil).toBeGreaterThan(Date.now());
    const [event] = await auditRows("auth.reauth");
    expect(JSON.parse(event?.metadata ?? "null")).toEqual({ method: "passkey" });
  });

  it("a tampered assertion is 401 and counts toward the factor limit", async () => {
    expect((await passkeyReauth({ tamper: true })).status).toBe(401);
    const row = await env.DB.prepare("SELECT failures FROM login_attempts WHERE key = ?")
      .bind(`m|${userId}`)
      .first<{ failures: number }>();
    expect(row?.failures).toBe(1);
  });
});

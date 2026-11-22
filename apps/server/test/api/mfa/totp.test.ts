import type { ApiErrorBody, MfaStatusDto, TotpSetupDto } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { base32Decode, hotp, timeStep } from "#src/mfa/totp";
import {
  api,
  auditRows,
  createUserWithSession,
  enablePasskey,
  enableTotp,
  json,
  jsonInit,
  mfaCall,
  resetDb,
  staleReauth,
  TEST_PASSWORD,
} from "#test/support";

const EMAIL = "totp@example.io";
let userId: string;
let cookie: string;
const call = (method: string, path: string, body?: unknown) => mfaCall(method, path, cookie, body);
const errorOf = async (res: Response) => (await json<ApiErrorBody>(res)).error;
const REAUTH = { code: "reauth_required", message: "Confirm it's you to continue" };

async function setUp(): Promise<{ secret: Uint8Array; recoveryCodes?: string[] }> {
  const res = await call("POST", "/auth/mfa/totp");
  expect(res.status).toBe(200);
  const dto = await json<TotpSetupDto>(res);
  const secret = base32Decode(dto.secret);
  const code = await hotp(secret, timeStep(Date.now()));
  const confirm = await call("POST", "/auth/mfa/totp/confirm", { code });
  expect(confirm.status).toBe(200);
  return { secret, ...(await json<{ recoveryCodes?: string[] }>(confirm)) };
}
const passwordLogin = () =>
  api("/api/v1/auth/login", jsonInit("POST", { email: EMAIL, password: TEST_PASSWORD }));

beforeEach(async () => {
  await resetDb();
  ({ userId, cookie } = await createUserWithSession({ email: EMAIL }));
});

describe("TOTP management", () => {
  it("setup returns a base32 secret and the otpauth URI for this instance", async () => {
    const dto = await json<TotpSetupDto>(await call("POST", "/auth/mfa/totp"));
    expect(dto.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(dto.otpauthUri).toBe(
      `otpauth://totp/Anchor%20(anchor.test)%3Atotp%40example.io?secret=${dto.secret}&issuer=Anchor%20(anchor.test)&algorithm=SHA1&digits=6&period=30`,
    );
  });

  it("confirming with a wrong code is 401 and leaves MFA off", async () => {
    await call("POST", "/auth/mfa/totp");
    const res = await call("POST", "/auth/mfa/totp/confirm", { code: "000000" });
    expect(await errorOf(res)).toEqual({
      code: "invalid_credentials",
      message: "Invalid authentication code",
    });
    expect((await json<MfaStatusDto>(await call("GET", "/auth/mfa"))).enabled).toBe(false);
  });

  it("confirming turns MFA on and hands out 10 recovery codes once", async () => {
    const { recoveryCodes } = await setUp();
    expect(recoveryCodes).toHaveLength(10);
    const status = await json<MfaStatusDto>(await call("GET", "/auth/mfa"));
    expect(status).toMatchObject({ enabled: true, totp: true, recoveryCodesRemaining: 10 });
    const [event] = await auditRows("mfa.totp_enabled");
    expect(event?.actor_id).toBe(userId);
    expect(event?.metadata).not.toContain(recoveryCodes?.[0] ?? "x");
    expect(await errorOf(await call("POST", "/auth/mfa/totp"))).toEqual({
      code: "conflict",
      message: "Two-factor authentication is already on",
    });
  });

  it("confirming when a passkey was already on returns no recovery codes", async () => {
    await enablePasskey(userId);
    const { recoveryCodes } = await setUp();
    expect(recoveryCodes).toBeUndefined();
  });

  it("disabling the only factor removes the recovery codes and the second login step", async () => {
    await setUp();
    expect((await call("DELETE", "/auth/mfa/totp")).status).toBe(204);
    expect(await auditRows("mfa.totp_disabled")).toHaveLength(1);
    const status = await json<MfaStatusDto>(await call("GET", "/auth/mfa"));
    expect(status).toMatchObject({ enabled: false, totp: false, recoveryCodesRemaining: 0 });
    const login = await json<{ mfaRequired?: boolean; user?: unknown }>(await passwordLogin());
    expect(login.mfaRequired).toBeUndefined();
    expect(login.user).toBeDefined();
    expect((await call("DELETE", "/auth/mfa/totp")).status).toBe(404);
  });

  it("every change needs a step-up within 10 minutes", async () => {
    await staleReauth(userId);
    expect(await errorOf(await call("POST", "/auth/mfa/totp"))).toEqual(REAUTH);
    expect(await errorOf(await call("POST", "/auth/mfa/totp/confirm", { code: "1" }))).toEqual(
      REAUTH,
    );
    expect(await errorOf(await call("DELETE", "/auth/mfa/totp"))).toEqual(REAUTH);
    expect(await errorOf(await call("POST", "/auth/mfa/recovery-codes"))).toEqual(REAUTH);
    expect((await call("GET", "/auth/mfa")).status).toBe(200);
  });

  it("a stale stolen session cannot turn TOTP off without the factor", async () => {
    const { codeAt } = await enableTotp(userId);
    await staleReauth(userId);
    expect((await call("DELETE", "/auth/mfa/totp")).status).toBe(403);
    expect(
      (await call("POST", "/auth/reauth", { method: "password", password: TEST_PASSWORD })).status,
    ).toBe(400);
    expect((await call("POST", "/auth/reauth", { method: "totp", code: "000000" })).status).toBe(
      401,
    );
    expect((await call("DELETE", "/auth/mfa/totp")).status).toBe(403);
    const code = await codeAt(Date.now());
    expect((await call("POST", "/auth/reauth", { method: "totp", code })).status).toBe(200);
    expect((await call("DELETE", "/auth/mfa/totp")).status).toBe(204);
  });

  it("cli sessions cannot manage MFA", async () => {
    const cli = await createUserWithSession({ kind: "cli" });
    for (const [method, path] of [
      ["GET", "/auth/mfa"],
      ["POST", "/auth/mfa/totp"],
      ["DELETE", "/auth/mfa/totp"],
      ["POST", "/auth/mfa/recovery-codes"],
    ] as const) {
      const bearer = await api(`/api/v1${path}`, jsonInit(method, undefined, { token: cli.token }));
      expect(bearer.status, `${method} ${path}`).toBe(403);
    }
  });
});

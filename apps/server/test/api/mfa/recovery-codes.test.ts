import type { ApiErrorBody, MfaRequiredResponse } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  api,
  auditRows,
  createUserWithSession,
  enableTotp,
  giveRecoveryCodes,
  json,
  jsonInit,
  mfaCall,
  resetDb,
  TEST_PASSWORD,
} from "#test/support";

const EMAIL = "codes@example.io";
let userId: string;
let cookie: string;

beforeEach(async () => {
  await resetDb();
  ({ userId, cookie } = await createUserWithSession({ email: EMAIL }));
});

describe("POST /auth/mfa/recovery-codes", () => {
  it("is refused while MFA is off", async () => {
    const res = await mfaCall("POST", "/auth/mfa/recovery-codes", cookie);
    expect((await json<ApiErrorBody>(res)).error).toEqual({
      code: "conflict",
      message: "Turn on two-factor authentication first",
    });
  });

  it("regenerating gives 10 new codes and the old ones stop working at login", async () => {
    await enableTotp(userId);
    const old = await giveRecoveryCodes(userId);
    const res = await mfaCall("POST", "/auth/mfa/recovery-codes", cookie);
    expect(res.status).toBe(200);
    const { recoveryCodes } = await json<{ recoveryCodes: string[] }>(res);
    expect(recoveryCodes).toHaveLength(10);
    expect(recoveryCodes).not.toContain(old[0]);
    const [event] = await auditRows("mfa.recovery_codes_generated");
    expect(event?.metadata ?? "").not.toContain(recoveryCodes[0] ?? "x");
    const { ticket } = await json<MfaRequiredResponse>(
      await api("/api/v1/auth/login", jsonInit("POST", { email: EMAIL, password: TEST_PASSWORD })),
    );
    const stale = await api(
      "/api/v1/auth/login/mfa",
      jsonInit("POST", { ticket, method: "recovery", code: old[0] }),
    );
    expect(stale.status).toBe(401);
    const fresh = await api(
      "/api/v1/auth/login/mfa",
      jsonInit("POST", { ticket, method: "recovery", code: recoveryCodes[0] }),
    );
    expect(fresh.status).toBe(200);
  });
});

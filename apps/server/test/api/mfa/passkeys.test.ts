import { env } from "cloudflare:workers";
import type { ApiErrorBody, MfaStatusDto, PasskeyDto } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  apiAt,
  auditRows,
  createSoftAuthenticator,
  createUserWithSession,
  enablePasskey,
  enableTotp,
  json,
  mfaCall,
  resetDb,
  type SoftAuthenticator,
  staleReauth,
  TEST_ORIGIN,
} from "#test/support";

let userId: string;
let cookie: string;
const call = (method: string, path: string, body?: unknown) => mfaCall(method, path, cookie, body);
const errorOf = async (res: Response) => (await json<ApiErrorBody>(res)).error;
const soft = () => createSoftAuthenticator({ rpId: "anchor.test", origin: TEST_ORIGIN });

async function register(auth: SoftAuthenticator, name = "Laptop") {
  const opts = await json<{ options: { challenge: string } }>(
    await call("POST", "/auth/mfa/passkeys/options"),
  );
  return call("POST", "/auth/mfa/passkeys", { name, response: await auth.register(opts.options) });
}
const status = async () => json<MfaStatusDto>(await call("GET", "/auth/mfa"));
const codesLeft = async () => (await status()).recoveryCodesRemaining;

beforeEach(async () => {
  await resetDb();
  ({ userId, cookie } = await createUserWithSession());
});

describe("passkey registration", () => {
  it("registers a first passkey and hands out recovery codes", async () => {
    const auth = await soft();
    const res = await register(auth);
    expect(res.status).toBe(201);
    const body = await json<{ passkey: PasskeyDto; recoveryCodes?: string[] }>(res);
    expect(body.passkey).toMatchObject({
      id: auth.credentialId,
      name: "Laptop",
      rpId: "anchor.test",
      usableHere: true,
      lastUsedAt: null,
    });
    expect(body.recoveryCodes).toHaveLength(10);
    const [event] = await auditRows("mfa.passkey_added");
    expect(JSON.parse(event?.metadata ?? "null")).toEqual({
      passkeyId: auth.credentialId,
      name: "Laptop",
    });
  });

  it("no recovery codes when TOTP was already on", async () => {
    await enableTotp(userId);
    const body = await json<{ recoveryCodes?: string[] }>(await register(await soft()));
    expect(body.recoveryCodes).toBeUndefined();
  });

  it("the options exclude passkeys already registered here", async () => {
    const existing = await enablePasskey(userId);
    const res = await call("POST", "/auth/mfa/passkeys/options");
    const { options } = await json<{ options: { excludeCredentials: { id: string }[] } }>(res);
    expect(options.excludeCredentials.map((c) => c.id)).toEqual([existing.credentialId]);
  });

  it("an answer to a stale, missing or other session's challenge is refused", async () => {
    const auth = await soft();
    const noOptions = await call("POST", "/auth/mfa/passkeys", {
      name: "X",
      response: await auth.register({ challenge: "made-up" }),
    });
    expect(noOptions.status).toBe(400);
    const opts = await json<{ options: { challenge: string } }>(
      await call("POST", "/auth/mfa/passkeys/options"),
    );
    const other = await createUserWithSession();
    const stolen = await mfaCall("POST", "/auth/mfa/passkeys", other.cookie, {
      name: "X",
      response: await auth.register(opts.options),
    });
    expect(stolen.status).toBe(400);
    await env.DB.prepare("UPDATE webauthn_challenges SET expires_at = 1").run();
    const expired = await call("POST", "/auth/mfa/passkeys", {
      name: "X",
      response: await auth.register(opts.options),
    });
    expect(expired.status).toBe(400);
  });

  it("a registration for another origin is refused", async () => {
    const evil = await createSoftAuthenticator({ rpId: "anchor.test", origin: "http://evil.test" });
    expect((await register(evil)).status).toBe(400);
  });

  it("caps at 20 passkeys and validates the name", async () => {
    for (let i = 0; i < 20; i++) await enablePasskey(userId, undefined, `k${i}`);
    expect(await errorOf(await register(await soft()))).toEqual({
      code: "conflict",
      message: "You can register at most 20 passkeys",
    });
    await env.DB.prepare("DELETE FROM webauthn_credentials").run();
    expect((await register(await soft(), "a".repeat(65))).status).toBe(400);
  });

  it("needs a recent step-up", async () => {
    await staleReauth(userId);
    expect((await call("POST", "/auth/mfa/passkeys/options")).status).toBe(403);
  });
});

describe("passkeys seen from another hostname", () => {
  it("are listed as registered elsewhere and not usable here", async () => {
    await enablePasskey(userId);
    const res = await apiAt("https://other.example", "/api/v1/auth/mfa", { headers: { cookie } });
    const body = await json<MfaStatusDto>(res);
    expect(body.passkeys).toEqual([
      expect.objectContaining({ rpId: "anchor.test", usableHere: false }),
    ]);
  });
});

describe("passkey removal", () => {
  it("removing the only passkey while TOTP is on keeps the recovery codes", async () => {
    await enableTotp(userId);
    const auth = await soft();
    await register(auth);
    await call("POST", "/auth/mfa/recovery-codes");
    expect((await call("DELETE", `/auth/mfa/passkeys/${auth.credentialId}`)).status).toBe(204);
    expect(await codesLeft()).toBe(10);
    const [event] = await auditRows("mfa.passkey_removed");
    expect(JSON.parse(event?.metadata ?? "null")).toEqual({
      passkeyId: auth.credentialId,
      name: "Laptop",
    });
  });

  it("removing the last factor removes the recovery codes", async () => {
    const auth = await soft();
    await register(auth);
    expect(await codesLeft()).toBe(10);
    await call("DELETE", `/auth/mfa/passkeys/${auth.credentialId}`);
    expect(await status()).toMatchObject({ enabled: false, recoveryCodesRemaining: 0 });
  });

  it("another user's passkey id is not found", async () => {
    const other = await createUserWithSession();
    const theirs = await enablePasskey(other.userId);
    expect((await call("DELETE", `/auth/mfa/passkeys/${theirs.credentialId}`)).status).toBe(404);
  });
});

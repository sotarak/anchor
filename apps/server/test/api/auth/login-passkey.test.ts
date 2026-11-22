import { env } from "cloudflare:workers";
import type { ApiErrorBody, LoginResponse, MfaRequiredResponse } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { findPasskey } from "#src/mfa/passkey-store";
import {
  api,
  auditRows,
  createSoftAuthenticator,
  createUserWithSession,
  enablePasskey,
  json,
  jsonInit,
  resetDb,
  type SoftAuthenticator,
  TEST_PASSWORD,
} from "#test/support";

const EMAIL = "key@example.io";
let userId: string;
let auth: SoftAuthenticator;

async function ticket(): Promise<MfaRequiredResponse> {
  const res = await api(
    "/api/v1/auth/login",
    jsonInit("POST", { email: EMAIL, password: TEST_PASSWORD }),
  );
  return json<MfaRequiredResponse>(res);
}
async function options(t: string) {
  const res = await api("/api/v1/auth/login/passkey/options", jsonInit("POST", { ticket: t }));
  return {
    res,
    body: res.status === 200 ? await json<{ options: { challenge: string } }>(res) : null,
  };
}
const finish = (t: string, response: unknown) =>
  api("/api/v1/auth/login/passkey", jsonInit("POST", { ticket: t, response }));
const errorOf = async (res: Response) => (await json<ApiErrorBody>(res)).error;
const INVALID = { code: "invalid_credentials", message: "Invalid authentication code" };

beforeEach(async () => {
  await resetDb();
  ({ userId } = await createUserWithSession({ email: EMAIL }));
  auth = await enablePasskey(userId);
});

describe("passkey as the second login step", () => {
  it("offers passkey, then signs in with an assertion and updates the counter", async () => {
    const t = await ticket();
    expect(t.methods).toEqual(["passkey", "recovery"]);
    const { body } = await options(t.ticket);
    const res = await finish(t.ticket, await auth.authenticate(body?.options ?? { challenge: "" }));
    expect(res.status).toBe(200);
    expect((await json<LoginResponse>(res)).user.email).toBe(EMAIL);
    const [event] = await auditRows("auth.login");
    expect(JSON.parse(event?.metadata ?? "null")).toEqual({
      client: "web",
      method: "password+passkey",
    });
    const row = await findPasskey(env.DB, userId, auth.credentialId);
    expect(row?.counter).toBe(1);
    expect(row?.lastUsedAt).not.toBeNull();
  });

  it("the options list only this user's passkeys", async () => {
    const t = await ticket();
    const { body } = await options(t.ticket);
    const allow = (body?.options as unknown as { allowCredentials: { id: string }[] })
      .allowCredentials;
    expect(allow.map((c) => c.id)).toEqual([auth.credentialId]);
  });

  it("a challenge answers once: replaying the assertion fails", async () => {
    const t1 = await ticket();
    const { body } = await options(t1.ticket);
    const assertion = await auth.authenticate(body?.options ?? { challenge: "" });
    expect((await finish(t1.ticket, assertion)).status).toBe(200);
    const t2 = await ticket();
    await options(t2.ticket);
    expect((await finish(t2.ticket, assertion)).status).toBe(401);
  });

  it("an assertion for another origin or with a bad signature is refused and counted", async () => {
    const t = await ticket();
    for (const o of [{ origin: "http://evil.test" }, { tamper: true }]) {
      const { body } = await options(t.ticket);
      const res = await finish(
        t.ticket,
        await auth.authenticate(body?.options ?? { challenge: "" }, o),
      );
      expect(await errorOf(res)).toEqual(INVALID);
    }
    const reasons = (await auditRows("auth.login_failed")).map(
      (r) => JSON.parse(r.metadata).reason,
    );
    expect(reasons).toEqual(["mfa_invalid", "mfa_invalid"]);
    const counter = await env.DB.prepare("SELECT failures FROM login_attempts WHERE key = ?")
      .bind(`m|${userId}`)
      .first<{ failures: number }>();
    expect(counter?.failures).toBe(2);
  });

  it("another user's passkey cannot finish this login", async () => {
    const { userId: other } = await createUserWithSession();
    const stranger = await enablePasskey(other);
    const t = await ticket();
    const { body } = await options(t.ticket);
    const res = await finish(
      t.ticket,
      await stranger.authenticate(body?.options ?? { challenge: "" }),
    );
    expect(await errorOf(res)).toEqual(INVALID);
  });

  it("finishing without asking for options first is refused", async () => {
    const t = await ticket();
    const res = await finish(t.ticket, await auth.authenticate({ challenge: "made-up" }));
    expect(res.status).toBe(401);
  });

  it("a passkey from another hostname is neither offered nor usable", async () => {
    await env.DB.prepare("DELETE FROM webauthn_credentials").run();
    await enablePasskey(userId, { rpId: "other.example", origin: "https://other.example" });
    const t = await ticket();
    expect(t.methods).toEqual(["recovery"]);
    const { res } = await options(t.ticket);
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toEqual({
      code: "bad_request",
      message: "No passkey for this address",
    });
  });

  it("options for an unknown or expired ticket answer 401", async () => {
    const t = await ticket();
    await env.DB.prepare("UPDATE mfa_tickets SET expires_at = 1").run();
    expect((await options(t.ticket)).res.status).toBe(401);
    expect((await options("anc_mfa_nope")).res.status).toBe(401);
  });

  it("an unregistered authenticator is refused", async () => {
    const unknown = await createSoftAuthenticator({
      rpId: "anchor.test",
      origin: "http://anchor.test",
    });
    const t = await ticket();
    const { body } = await options(t.ticket);
    const res = await finish(
      t.ticket,
      await unknown.authenticate(body?.options ?? { challenge: "" }),
    );
    expect(await errorOf(res)).toEqual(INVALID);
  });
});

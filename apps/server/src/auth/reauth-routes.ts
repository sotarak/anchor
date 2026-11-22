import { reauthBodySchema, reauthPasskeyBodySchema } from "@anchor/shared";
import { type Context, Hono } from "hono";
import { recordAudit } from "../audit/record";
import { getRootKeyring } from "../crypto/keyring";
import { verifyPassword } from "../crypto/password";
import type { AppEnv, UserPrincipal } from "../env";
import { ApiError } from "../lib/errors";
import { parseJson } from "../lib/validate";
import { storeChallenge, takeChallenge } from "../mfa/challenges";
import { findPasskey, listPasskeys, touchPasskey } from "../mfa/passkey-store";
import { consumeRecoveryCode } from "../mfa/recovery-store";
import { hasMfa } from "../mfa/status";
import { consumeTotpCode } from "../mfa/totp-store";
import {
  authenticationOptions,
  credentialIdOf,
  relyingPartyFor,
  verifyAuthentication,
} from "../mfa/webauthn";
import { findUserById, reserveLoginAttempt, type UserRow, updateLoginState } from "../users/repo";
import { LOCKOUT_MS, MAX_FAILED_LOGINS } from "./lockout";
import { clearFactorAttempts, factorAttemptKey, reserveLoginKeys } from "./login-attempts";
import { requireWebUser } from "./middleware";
import { markReauthenticated } from "./reauth";

/**
 * Step-up (spec 2026-11-22-v0.6.0-mfa): a dashboard session proves it is still its person before
 * changing MFA. Without MFA the password does; with MFA only a factor does, so a stolen session
 * plus a phished password cannot remove the second factor.
 */
export const reauthRoutes = new Hono<AppEnv>();

const LOCKED = () => new ApiError(429, "rate_limited", "Too many failed attempts, try again later");
export const INVALID_CODE = () =>
  new ApiError(401, "invalid_credentials", "Invalid authentication code");

export async function reauthPrincipal(
  c: Context<AppEnv>,
): Promise<{ principal: UserPrincipal; user: UserRow }> {
  const principal = await requireWebUser(c, "Confirm it's you from the dashboard");
  const user = await findUserById(c.env.DB, principal.userId);
  if (!user) throw new ApiError(401, "unauthenticated", "Authentication required");
  return { principal, user };
}

/** Counts a factor guess against the account (`m|<userId>`), shared with the login step. */
export async function reserveReauthFactor(db: D1Database, userId: string, now: number) {
  if (!(await reserveLoginKeys(db, [factorAttemptKey(userId)], now))) throw LOCKED();
}

export async function finishReauth(
  c: Context<AppEnv>,
  principal: UserPrincipal,
  method: "password" | "totp" | "recovery" | "passkey",
  now: number,
): Promise<Response> {
  const reauthUntil = await markReauthenticated(c.env.DB, principal.sessionId, now);
  await recordAudit(c, { action: "auth.reauth", target: principal.userId, metadata: { method } });
  return c.json<{ reauthUntil: number }>({ reauthUntil });
}

reauthRoutes.post("/auth/reauth", async (c) => {
  const { principal, user } = await reauthPrincipal(c);
  const body = await parseJson(c, reauthBodySchema);
  const now = Date.now();
  const mfa = await hasMfa(c.env.DB, user.id);
  if (body.method === "password") {
    if (mfa) {
      throw new ApiError(
        400,
        "bad_request",
        "Confirm with your authenticator app, a passkey or a recovery code",
      );
    }
    const limits = { maxFailures: MAX_FAILED_LOGINS, lockoutMs: LOCKOUT_MS };
    if (!(await reserveLoginAttempt(c.env.DB, user.id, now, limits))) throw LOCKED();
    if (!(await verifyPassword(body.password, user.password_hash))) {
      throw new ApiError(401, "invalid_credentials", "Password is incorrect");
    }
    await updateLoginState(c.env.DB, user.id, { failedLogins: 0, lockedUntil: null });
    return finishReauth(c, principal, "password", now);
  }
  if (!mfa) throw new ApiError(400, "bad_request", "Confirm with your password");
  await reserveReauthFactor(c.env.DB, user.id, now);
  const ok =
    body.method === "totp"
      ? await consumeTotpCode(c.env.DB, await getRootKeyring(c.env), user.id, body.code, now)
      : await consumeRecoveryCode(c.env.DB, user.id, body.code, now);
  if (!ok) throw INVALID_CODE();
  await clearFactorAttempts(c.env.DB, user.id);
  return finishReauth(c, principal, body.method, now);
});

reauthRoutes.post("/auth/reauth/passkey/options", async (c) => {
  const { principal, user } = await reauthPrincipal(c);
  const rp = relyingPartyFor(c.req.url);
  const allow = (await listPasskeys(c.env.DB, user.id)).filter((p) => p.rpId === rp.id);
  if (allow.length === 0) throw new ApiError(400, "bad_request", "No passkey for this address");
  const { options, challenge } = await authenticationOptions(rp, allow);
  await storeChallenge(
    c.env.DB,
    user.id,
    { purpose: "reauth", sessionId: principal.sessionId },
    challenge,
    Date.now(),
  );
  return c.json({ options });
});

reauthRoutes.post("/auth/reauth/passkey", async (c) => {
  const { principal, user } = await reauthPrincipal(c);
  const body = await parseJson(c, reauthPasskeyBodySchema);
  const now = Date.now();
  await reserveReauthFactor(c.env.DB, user.id, now);
  const rp = relyingPartyFor(c.req.url);
  const challenge = await takeChallenge(
    c.env.DB,
    user.id,
    { purpose: "reauth", sessionId: principal.sessionId },
    now,
  );
  const credentialId = credentialIdOf(body.response);
  const passkey = credentialId ? await findPasskey(c.env.DB, user.id, credentialId) : null;
  if (!challenge || !passkey || passkey.rpId !== rp.id) throw INVALID_CODE();
  const verified = await verifyAuthentication(rp, body.response, challenge, passkey);
  if (!verified) throw INVALID_CODE();
  await touchPasskey(c.env.DB, passkey.id, verified.newCounter, now);
  await clearFactorAttempts(c.env.DB, user.id);
  return finishReauth(c, principal, "passkey", now);
});

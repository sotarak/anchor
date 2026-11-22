import { loginMfaBodySchema, loginPasskeyBodySchema, mfaTicketBodySchema } from "@anchor/shared";
import { type Context, Hono } from "hono";
import { recordAudit } from "../audit/record";
import { getRootKeyring } from "../crypto/keyring";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/errors";
import { parseJson } from "../lib/validate";
import { storeChallenge, takeChallenge } from "../mfa/challenges";
import { findPasskey, listPasskeys, touchPasskey } from "../mfa/passkey-store";
import { consumeRecoveryCode, countRecoveryCodes } from "../mfa/recovery-store";
import {
  consumeMfaTicket,
  findMfaTicket,
  type MfaTicket,
  recordTicketFailure,
} from "../mfa/tickets";
import { consumeTotpCode } from "../mfa/totp-store";
import {
  authenticationOptions,
  credentialIdOf,
  relyingPartyFor,
  verifyAuthentication,
} from "../mfa/webauthn";
import { findUserById, type UserRow } from "../users/repo";
import { issueLoginSession, type LoginMethod } from "./finish-login";
import { clearFactorAttempts, factorAttemptKey, reserveLoginKeys } from "./login-attempts";

/**
 * The second login step (spec 2026-11-22-v0.6.0-mfa). Anonymous: the ticket from `/auth/login`
 * plus one factor yields the session. Wrong factors count per ticket (5, then it dies) and per
 * account (`m|<userId>`, 5 per 15 minutes), so knowing the password does not allow guessing codes.
 */
export const mfaLoginRoutes = new Hono<AppEnv>();

const EXPIRED = () => new ApiError(401, "unauthenticated", "Sign-in expired, start again");
const INVALID = () => new ApiError(401, "invalid_credentials", "Invalid authentication code");
const LOCKED = () => new ApiError(429, "rate_limited", "Too many failed attempts, try again later");

/** The ticket and its user; 401 when the ticket is unknown or expired or the user is gone or disabled. */
export async function loadTicketUser(
  c: Context<AppEnv>,
  ticket: string,
  now: number,
): Promise<{ ticket: MfaTicket; user: UserRow }> {
  const t = await findMfaTicket(c.env.DB, ticket, now);
  if (!t) throw EXPIRED();
  const user = await findUserById(c.env.DB, t.userId);
  if (!user || user.disabled_at !== null) throw EXPIRED();
  return { ticket: t, user };
}

const failedFactor = (c: Context<AppEnv>, user: UserRow, reason: "mfa_invalid" | "mfa_locked") =>
  recordAudit(c, {
    action: "auth.login_failed",
    actor: { type: "anonymous", id: null, label: user.email },
    metadata: { reason },
  });

/** Counts one factor attempt for the account; 429 (audited) when its second step is locked. */
export async function reserveFactorAttempt(
  c: Context<AppEnv>,
  user: UserRow,
  now: number,
): Promise<void> {
  if (!(await reserveLoginKeys(c.env.DB, [factorAttemptKey(user.id)], now))) {
    await failedFactor(c, user, "mfa_locked");
    throw LOCKED();
  }
}

/** A wrong factor at login: counts against the ticket, audited, 401. */
export async function rejectFactor(
  c: Context<AppEnv>,
  ticket: MfaTicket,
  user: UserRow,
): Promise<never> {
  await recordTicketFailure(c.env.DB, ticket.id);
  await failedFactor(c, user, "mfa_invalid");
  throw INVALID();
}

/** A correct factor: the ticket is spent (losing a race answers 401) and the session issued. */
export async function completeLogin(
  c: Context<AppEnv>,
  ticket: MfaTicket,
  user: UserRow,
  method: LoginMethod,
  now: number,
  extra: Record<string, unknown> = {},
): Promise<Response> {
  if (!(await consumeMfaTicket(c.env.DB, ticket.id, now))) throw EXPIRED();
  await clearFactorAttempts(c.env.DB, user.id);
  return issueLoginSession(c, user, ticket.client, method, now, extra);
}

mfaLoginRoutes.post("/auth/login/mfa", async (c) => {
  const body = await parseJson(c, loginMfaBodySchema);
  const now = Date.now();
  const { ticket, user } = await loadTicketUser(c, body.ticket, now);
  await reserveFactorAttempt(c, user, now);
  if (body.method === "totp") {
    const keyring = await getRootKeyring(c.env);
    if (!(await consumeTotpCode(c.env.DB, keyring, user.id, body.code, now))) {
      return rejectFactor(c, ticket, user);
    }
    return completeLogin(c, ticket, user, "password+totp", now);
  }
  if (!(await consumeRecoveryCode(c.env.DB, user.id, body.code, now))) {
    return rejectFactor(c, ticket, user);
  }
  const recoveryCodesRemaining = await countRecoveryCodes(c.env.DB, user.id);
  return completeLogin(c, ticket, user, "password+recovery", now, { recoveryCodesRemaining });
});

/** Assertion options for the ticket's user, limited to passkeys registered on this hostname. */
mfaLoginRoutes.post("/auth/login/passkey/options", async (c) => {
  const body = await parseJson(c, mfaTicketBodySchema);
  const now = Date.now();
  const { ticket, user } = await loadTicketUser(c, body.ticket, now);
  const rp = relyingPartyFor(c.req.url);
  const allow = (await listPasskeys(c.env.DB, user.id)).filter((p) => p.rpId === rp.id);
  if (allow.length === 0) throw new ApiError(400, "bad_request", "No passkey for this address");
  const { options, challenge } = await authenticationOptions(rp, allow);
  await storeChallenge(
    c.env.DB,
    user.id,
    { purpose: "login", ticketId: ticket.id },
    challenge,
    now,
  );
  return c.json({ options });
});

mfaLoginRoutes.post("/auth/login/passkey", async (c) => {
  const body = await parseJson(c, loginPasskeyBodySchema);
  const now = Date.now();
  const { ticket, user } = await loadTicketUser(c, body.ticket, now);
  await reserveFactorAttempt(c, user, now);
  const rp = relyingPartyFor(c.req.url);
  // The challenge is spent whatever happens next: an assertion answers one options call only.
  const challenge = await takeChallenge(
    c.env.DB,
    user.id,
    { purpose: "login", ticketId: ticket.id },
    now,
  );
  const credentialId = credentialIdOf(body.response);
  const passkey = credentialId ? await findPasskey(c.env.DB, user.id, credentialId) : null;
  if (!challenge || !passkey || passkey.rpId !== rp.id) return rejectFactor(c, ticket, user);
  const verified = await verifyAuthentication(rp, body.response, challenge, passkey);
  if (!verified) return rejectFactor(c, ticket, user);
  await touchPasskey(c.env.DB, passkey.id, verified.newCounter, now);
  return completeLogin(c, ticket, user, "password+passkey", now);
});

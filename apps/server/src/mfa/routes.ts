import {
  type MfaStatusDto,
  type PasskeyDto,
  passkeyCreateBodySchema,
  type TotpSetupDto,
  totpConfirmBodySchema,
} from "@anchor/shared";
import { type Context, Hono } from "hono";
import { recordAudit } from "../audit/record";
import { requireWebUser } from "../auth/middleware";
import { readReauthAt, requireRecentReauth } from "../auth/reauth";
import { getRootKeyring } from "../crypto/keyring";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/errors";
import { parseJson } from "../lib/validate";
import { storeChallenge, takeChallenge } from "./challenges";
import {
  deletePasskey,
  findPasskey,
  insertPasskey,
  listPasskeys,
  MAX_PASSKEYS,
  toPasskeyDto,
} from "./passkey-store";
import { replaceRecoveryCodes } from "./recovery-store";
import { afterFactorRemoved, hasMfa, mfaStatus } from "./status";
import { base32Encode, otpauthUri } from "./totp";
import { confirmTotp, deleteTotp, startTotpEnrollment } from "./totp-store";
import { registrationOptions, relyingPartyFor, verifyRegistration } from "./webauthn";

/**
 * Mounted at /api/v1/auth/mfa. Dashboard sessions only; every change needs a step-up in the last
 * 10 minutes (requireRecentReauth). Recovery codes are returned only when a change takes the
 * account from no MFA to MFA, and on regeneration; they are never audited or logged.
 */
export const mfaRoutes = new Hono<AppEnv>();

/** Fresh recovery codes when `wasOn` is false (the first factor), else nothing. */
export async function codesForFirstFactor(
  c: Context<AppEnv>,
  userId: string,
  wasOn: boolean,
): Promise<{ recoveryCodes?: string[] }> {
  if (wasOn) return {};
  return { recoveryCodes: await replaceRecoveryCodes(c.env.DB, userId, Date.now()) };
}

mfaRoutes.get("/", async (c) => {
  const principal = await requireWebUser(c, "Manage two-factor authentication from the dashboard");
  const reauthAt = await readReauthAt(c.env.DB, principal.sessionId);
  const rpId = relyingPartyFor(c.req.url).id;
  return c.json<MfaStatusDto>(
    await mfaStatus(c.env.DB, principal.userId, rpId, reauthAt, Date.now()),
  );
});

mfaRoutes.post("/totp", async (c) => {
  const principal = await requireRecentReauth(c);
  const keyring = await getRootKeyring(c.env);
  const secret = await startTotpEnrollment(c.env.DB, keyring, principal.userId, Date.now());
  if (!secret) throw new ApiError(409, "conflict", "Two-factor authentication is already on");
  const text = base32Encode(secret);
  secret.fill(0);
  const hostname = relyingPartyFor(c.req.url).id;
  return c.json<TotpSetupDto>({
    secret: text,
    otpauthUri: otpauthUri({ secret: text, email: principal.email, hostname }),
  });
});

mfaRoutes.post("/totp/confirm", async (c) => {
  const principal = await requireRecentReauth(c);
  const body = await parseJson(c, totpConfirmBodySchema);
  const wasOn = await hasMfa(c.env.DB, principal.userId);
  const keyring = await getRootKeyring(c.env);
  if (!(await confirmTotp(c.env.DB, keyring, principal.userId, body.code, Date.now()))) {
    throw new ApiError(401, "invalid_credentials", "Invalid authentication code");
  }
  await recordAudit(c, { action: "mfa.totp_enabled", target: principal.userId });
  return c.json(await codesForFirstFactor(c, principal.userId, wasOn));
});

mfaRoutes.delete("/totp", async (c) => {
  const principal = await requireRecentReauth(c);
  if (!(await deleteTotp(c.env.DB, principal.userId))) {
    throw new ApiError(404, "not_found", "Authenticator app is not set up");
  }
  await afterFactorRemoved(c.env.DB, principal.userId);
  await recordAudit(c, { action: "mfa.totp_disabled", target: principal.userId });
  return c.body(null, 204);
});

mfaRoutes.post("/recovery-codes", async (c) => {
  const principal = await requireRecentReauth(c);
  if (!(await hasMfa(c.env.DB, principal.userId))) {
    throw new ApiError(409, "conflict", "Turn on two-factor authentication first");
  }
  const recoveryCodes = await replaceRecoveryCodes(c.env.DB, principal.userId, Date.now());
  await recordAudit(c, { action: "mfa.recovery_codes_generated", target: principal.userId });
  return c.json<{ recoveryCodes: string[] }>({ recoveryCodes });
});

mfaRoutes.post("/passkeys/options", async (c) => {
  const principal = await requireRecentReauth(c);
  const rp = relyingPartyFor(c.req.url);
  const exclude = (await listPasskeys(c.env.DB, principal.userId)).filter((p) => p.rpId === rp.id);
  const { options, challenge } = await registrationOptions(
    rp,
    { id: principal.userId, email: principal.email, name: principal.name },
    exclude,
  );
  await storeChallenge(
    c.env.DB,
    principal.userId,
    { purpose: "register", sessionId: principal.sessionId },
    challenge,
    Date.now(),
  );
  return c.json({ options });
});

mfaRoutes.post("/passkeys", async (c) => {
  const principal = await requireRecentReauth(c);
  const body = await parseJson(c, passkeyCreateBodySchema);
  const now = Date.now();
  const rp = relyingPartyFor(c.req.url);
  const challenge = await takeChallenge(
    c.env.DB,
    principal.userId,
    { purpose: "register", sessionId: principal.sessionId },
    now,
  );
  if (!challenge) throw new ApiError(400, "bad_request", "Passkey setup expired, try again");
  const passkey = await verifyRegistration(rp, body.response, challenge);
  if (!passkey) throw new ApiError(400, "bad_request", "The passkey could not be verified");
  const wasOn = await hasMfa(c.env.DB, principal.userId);
  const outcome = await insertPasskey(c.env.DB, principal.userId, rp.id, body.name, passkey, now);
  if (outcome === "limit") {
    throw new ApiError(409, "conflict", `You can register at most ${MAX_PASSKEYS} passkeys`);
  }
  if (outcome === "duplicate") {
    throw new ApiError(409, "conflict", "This passkey is already registered");
  }
  await recordAudit(c, {
    action: "mfa.passkey_added",
    target: principal.userId,
    metadata: { passkeyId: passkey.id, name: body.name },
  });
  const row = await findPasskey(c.env.DB, principal.userId, passkey.id);
  if (!row) throw new ApiError(404, "not_found", "Passkey not found");
  return c.json<{ passkey: PasskeyDto; recoveryCodes?: string[] }>(
    {
      passkey: toPasskeyDto(row, rp.id),
      ...(await codesForFirstFactor(c, principal.userId, wasOn)),
    },
    201,
  );
});

mfaRoutes.delete("/passkeys/:id", async (c) => {
  const principal = await requireRecentReauth(c);
  const id = c.req.param("id");
  const row = await findPasskey(c.env.DB, principal.userId, id);
  if (!row || !(await deletePasskey(c.env.DB, principal.userId, id))) {
    throw new ApiError(404, "not_found", "Passkey not found");
  }
  await afterFactorRemoved(c.env.DB, principal.userId);
  await recordAudit(c, {
    action: "mfa.passkey_removed",
    target: principal.userId,
    metadata: { passkeyId: row.id, name: row.name },
  });
  return c.body(null, 204);
});

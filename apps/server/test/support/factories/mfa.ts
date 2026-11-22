import { env } from "cloudflare:workers";
import { getRootKeyring } from "#src/crypto/keyring";
import { insertPasskey } from "#src/mfa/passkey-store";
import { replaceRecoveryCodes } from "#src/mfa/recovery-store";
import { hotp, timeStep } from "#src/mfa/totp";
import { confirmTotp, startTotpEnrollment } from "#src/mfa/totp-store";
import { createSoftAuthenticator, type SoftAuthenticator } from "../webauthn";

/**
 * Turns on an authenticator app for the user. It is confirmed with the previous step's code, so
 * the current step's code is still unused and a test can log in with codeAt(Date.now()).
 */
export async function enableTotp(
  userId: string,
): Promise<{ secret: Uint8Array; codeAt(nowMs: number): Promise<string> }> {
  const now = Date.now();
  const keyring = await getRootKeyring(env);
  const secret = await startTotpEnrollment(env.DB, keyring, userId, now);
  if (!secret) throw new Error("TOTP already enabled");
  const previous = await hotp(secret, timeStep(now) - 1);
  if (!(await confirmTotp(env.DB, keyring, userId, previous, now))) {
    throw new Error("TOTP confirmation failed");
  }
  return { secret, codeAt: (nowMs) => hotp(secret, timeStep(nowMs)) };
}

export function giveRecoveryCodes(userId: string): Promise<string[]> {
  return replaceRecoveryCodes(env.DB, userId, Date.now());
}

/** Registers a software passkey for the user on `rp` directly in D1 and returns its authenticator. */
export async function enablePasskey(
  userId: string,
  rp: { rpId: string; origin: string } = { rpId: "anchor.test", origin: "http://anchor.test" },
  name = "Test key",
): Promise<SoftAuthenticator> {
  const auth = await createSoftAuthenticator(rp);
  const outcome = await insertPasskey(
    env.DB,
    userId,
    rp.rpId,
    name,
    {
      id: auth.credentialId,
      publicKey: auth.cosePublicKey,
      counter: 0,
      transports: ["internal"],
      backedUp: false,
    },
    Date.now(),
  );
  if (outcome !== "ok") throw new Error(`passkey insert: ${outcome}`);
  return auth;
}

import { env } from "cloudflare:workers";
import { getRootKeyring } from "#src/crypto/keyring";
import { replaceRecoveryCodes } from "#src/mfa/recovery-store";
import { hotp, timeStep } from "#src/mfa/totp";
import { confirmTotp, startTotpEnrollment } from "#src/mfa/totp-store";

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

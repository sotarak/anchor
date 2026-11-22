import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { utf8Encode } from "../lib/encoding";

/**
 * The only module that imports @simplewebauthn/server (spec 2026-11-22-v0.6.0-mfa). Passkeys are a
 * second factor: the password is already proven, so user verification is preferred, not required.
 * Every verify returns null for malformed or failing input and never throws.
 */
export type RelyingParty = { id: string; origin: string };
export type PasskeyRef = { id: string; transports: string[] | null };
export type StoredPasskey = PasskeyRef & { publicKey: Uint8Array; counter: number };
export type NewPasskey = StoredPasskey & { backedUp: boolean };

const RP_NAME = "Anchor";
const CREDENTIAL_ID = /^[A-Za-z0-9_-]{1,1024}$/;

/** RP ID = the request's hostname; expected origin = the request's origin. */
export function relyingPartyFor(requestUrl: string): RelyingParty {
  const url = new URL(requestUrl);
  return { id: url.hostname, origin: url.origin };
}

const refs = (list: PasskeyRef[]) =>
  list.map((p) => (p.transports ? { id: p.id, transports: p.transports } : { id: p.id }));

export async function registrationOptions(
  rp: RelyingParty,
  user: { id: string; email: string; name: string },
  exclude: PasskeyRef[],
): Promise<{ options: unknown; challenge: string }> {
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.id,
    userID: new Uint8Array(utf8Encode(user.id)),
    userName: user.email,
    userDisplayName: user.name,
    attestationType: "none",
    excludeCredentials: refs(exclude),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  return { options, challenge: options.challenge };
}

export async function verifyRegistration(
  rp: RelyingParty,
  response: unknown,
  expectedChallenge: string,
): Promise<NewPasskey | null> {
  if (credentialIdOf(response) === null) return null;
  try {
    const result = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: false,
    });
    if (!result.verified) return null;
    const { credential, credentialBackedUp } = result.registrationInfo;
    return {
      id: credential.id,
      publicKey: new Uint8Array(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? null,
      backedUp: credentialBackedUp,
    };
  } catch {
    return null;
  }
}

export async function authenticationOptions(
  rp: RelyingParty,
  allow: PasskeyRef[],
): Promise<{ options: unknown; challenge: string }> {
  const options = await generateAuthenticationOptions({
    rpID: rp.id,
    allowCredentials: refs(allow),
    userVerification: "preferred",
  });
  return { options, challenge: options.challenge };
}

export async function verifyAuthentication(
  rp: RelyingParty,
  response: unknown,
  expectedChallenge: string,
  credential: StoredPasskey,
): Promise<{ newCounter: number } | null> {
  if (credentialIdOf(response) !== credential.id) return null;
  try {
    const result = await verifyAuthenticationResponse({
      response: response as AuthenticationResponseJSON,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      credential: {
        id: credential.id,
        publicKey: new Uint8Array(credential.publicKey),
        counter: credential.counter,
        ...(credential.transports && { transports: credential.transports }),
      },
      requireUserVerification: false,
    });
    return result.verified ? { newCounter: result.authenticationInfo.newCounter } : null;
  } catch {
    return null;
  }
}

/** The response's credential id (base64url, at most 1024 chars), or null. */
export function credentialIdOf(response: unknown): string | null {
  if (response === null || typeof response !== "object") return null;
  const id = (response as { id?: unknown }).id;
  return typeof id === "string" && CREDENTIAL_ID.test(id) ? id : null;
}

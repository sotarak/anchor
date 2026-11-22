import {
  browserSupportsWebAuthn,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

/**
 * The only module that imports @simplewebauthn/browser. Options come from the server as opaque
 * JSON and the browser's answer goes back the same way; the server validates both.
 */
export function passkeysSupported(): boolean {
  return browserSupportsWebAuthn();
}

export function getPasskeyAssertion(options: unknown): Promise<unknown> {
  return startAuthentication({ optionsJSON: options as PublicKeyCredentialRequestOptionsJSON });
}

export function createPasskey(options: unknown): Promise<unknown> {
  return startRegistration({ optionsJSON: options as PublicKeyCredentialCreationOptionsJSON });
}

/** The user closed or refused the browser prompt: not an error worth showing. */
export function isPasskeyCancel(e: unknown): boolean {
  return e instanceof Error && (e.name === "NotAllowedError" || e.name === "AbortError");
}

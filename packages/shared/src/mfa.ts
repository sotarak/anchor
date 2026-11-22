import type { LoginResponse } from "./api";

/** Second factors a login can finish with (spec 2026-11-22-v0.6.0-mfa). */
export type MfaMethod = "totp" | "passkey" | "recovery";

/** `POST /auth/login` for a user with MFA: no session yet, finish with the ticket. */
export type MfaRequiredResponse = {
  mfaRequired: true;
  ticket: string;
  methods: MfaMethod[];
  expiresAt: number;
};

export type LoginResult = LoginResponse | MfaRequiredResponse;

export function isMfaRequired(r: LoginResult): r is MfaRequiredResponse {
  return "mfaRequired" in r && r.mfaRequired === true;
}

export type PasskeyDto = {
  /** The WebAuthn credential id, base64url. */
  id: string;
  name: string;
  /** The hostname the passkey was registered on; it works only there. */
  rpId: string;
  /** True when rpId is the hostname of this request. */
  usableHere: boolean;
  backedUp: boolean;
  createdAt: number;
  lastUsedAt: number | null;
};

export type MfaStatusDto = {
  /** A confirmed TOTP or at least one passkey. */
  enabled: boolean;
  totp: boolean;
  passkeys: PasskeyDto[];
  recoveryCodesRemaining: number;
  /** Until when MFA changes are allowed without re-authenticating; null when not now. */
  reauthUntil: number | null;
};

export type TotpSetupDto = { secret: string; otpauthUri: string };

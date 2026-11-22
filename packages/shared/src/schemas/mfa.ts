import { z } from "zod";

/** The short-lived second-step ticket (`anc_mfa_...`) as submitted by clients. */
export const mfaTicketSchema = z.string().min(1).max(200);

const codeSchema = z.string().min(1).max(32);

/**
 * A WebAuthn credential as @simplewebauthn/browser posts it. Only the outer shape is checked here;
 * the server's WebAuthn verification checks the rest. Unknown keys are kept for the verifier.
 */
export const webauthnResponseSchema = z.looseObject({
  id: z.string().min(1).max(1024),
  rawId: z.string().min(1).max(1024),
  type: z.literal("public-key"),
  response: z.record(z.string(), z.unknown()),
});

/** `POST /auth/login/mfa`: finish a login with a TOTP or recovery code. */
export const loginMfaBodySchema = z.object({
  ticket: mfaTicketSchema,
  method: z.enum(["totp", "recovery"]),
  code: codeSchema,
});

/** `POST /auth/login/passkey/options`. */
export const mfaTicketBodySchema = z.object({ ticket: mfaTicketSchema });

/** `POST /auth/login/passkey`. */
export const loginPasskeyBodySchema = z.object({
  ticket: mfaTicketSchema,
  response: webauthnResponseSchema,
});

/** `POST /auth/reauth`: the password without MFA, a code with it. */
export const reauthBodySchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("password"), password: z.string().min(1).max(1024) }),
  z.object({ method: z.enum(["totp", "recovery"]), code: codeSchema }),
]);

/** `POST /auth/reauth/passkey`. */
export const reauthPasskeyBodySchema = z.object({ response: webauthnResponseSchema });

/** `POST /auth/mfa/totp/confirm`. */
export const totpConfirmBodySchema = z.object({ code: codeSchema });

/** `POST /auth/mfa/passkeys`. */
export const passkeyCreateBodySchema = z.object({
  name: z.string().trim().min(1).max(64),
  response: webauthnResponseSchema,
});

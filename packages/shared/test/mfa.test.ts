import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS } from "../src/audit";
import { ERROR_CODES } from "../src/errors";
import { isMfaRequired } from "../src/mfa";

const user = { id: "u", email: "a@b.io", name: "A", role: "member" as const };

describe("isMfaRequired", () => {
  it("tells a second-step answer from a login", () => {
    expect(isMfaRequired({ mfaRequired: true, ticket: "t", methods: ["totp"], expiresAt: 1 })).toBe(
      true,
    );
    expect(isMfaRequired({ user, expiresAt: 1 })).toBe(false);
    expect(isMfaRequired({ user, token: "anc_s_x", expiresAt: 1 })).toBe(false);
  });
});

describe("0.6.0 audit actions and error codes", () => {
  it("appends the MFA actions in order", () => {
    expect(AUDIT_ACTIONS.slice(-7)).toEqual([
      "auth.reauth",
      "mfa.totp_enabled",
      "mfa.totp_disabled",
      "mfa.passkey_added",
      "mfa.passkey_removed",
      "mfa.recovery_codes_generated",
      "mfa.reset",
    ]);
  });

  it("has reauth_required", () => {
    expect(ERROR_CODES).toContain("reauth_required");
  });
});

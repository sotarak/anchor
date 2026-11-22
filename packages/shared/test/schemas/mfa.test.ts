import { describe, expect, it } from "vitest";
import {
  loginMfaBodySchema,
  loginPasskeyBodySchema,
  mfaTicketBodySchema,
  passkeyCreateBodySchema,
  reauthBodySchema,
  reauthPasskeyBodySchema,
  totpConfirmBodySchema,
  webauthnResponseSchema,
} from "../../src/schemas/mfa";

const TICKET = "anc_mfa_abc";
const RESPONSE = { id: "cred_1", rawId: "cred_1", type: "public-key", response: { a: "b" } };

describe("loginMfaBodySchema", () => {
  it("accepts totp and recovery codes", () => {
    expect(
      loginMfaBodySchema.safeParse({ ticket: TICKET, method: "totp", code: "123456" }).success,
    ).toBe(true);
    expect(
      loginMfaBodySchema.safeParse({ ticket: TICKET, method: "recovery", code: "abcde-fghij" })
        .success,
    ).toBe(true);
  });

  it("rejects passkey as a code method, an empty ticket and a long code", () => {
    expect(
      loginMfaBodySchema.safeParse({ ticket: TICKET, method: "passkey", code: "1" }).success,
    ).toBe(false);
    expect(loginMfaBodySchema.safeParse({ ticket: "", method: "totp", code: "1" }).success).toBe(
      false,
    );
    expect(
      loginMfaBodySchema.safeParse({ ticket: TICKET, method: "totp", code: "1".repeat(33) })
        .success,
    ).toBe(false);
    expect(
      loginMfaBodySchema.safeParse({ ticket: "t".repeat(201), method: "totp", code: "1" }).success,
    ).toBe(false);
  });
});

describe("webauthnResponseSchema", () => {
  it("accepts a public-key credential and keeps unknown keys", () => {
    const parsed = webauthnResponseSchema.parse({ ...RESPONSE, clientExtensionResults: {} });
    expect(parsed).toHaveProperty("clientExtensionResults");
  });

  it("rejects a 2000-character id and another type", () => {
    expect(webauthnResponseSchema.safeParse({ ...RESPONSE, id: "a".repeat(2000) }).success).toBe(
      false,
    );
    expect(webauthnResponseSchema.safeParse({ ...RESPONSE, type: "password" }).success).toBe(false);
    expect(webauthnResponseSchema.safeParse({ ...RESPONSE, response: "x" }).success).toBe(false);
  });
});

describe("ticket and passkey bodies", () => {
  it("parse the shapes of the endpoints table", () => {
    expect(mfaTicketBodySchema.safeParse({ ticket: TICKET }).success).toBe(true);
    expect(loginPasskeyBodySchema.safeParse({ ticket: TICKET, response: RESPONSE }).success).toBe(
      true,
    );
    expect(reauthPasskeyBodySchema.safeParse({ response: RESPONSE }).success).toBe(true);
    expect(totpConfirmBodySchema.safeParse({ code: "123456" }).success).toBe(true);
    expect(totpConfirmBodySchema.safeParse({ code: "" }).success).toBe(false);
  });

  it("passkey names are trimmed, 1 to 64 characters", () => {
    expect(passkeyCreateBodySchema.parse({ name: "  Laptop  ", response: RESPONSE }).name).toBe(
      "Laptop",
    );
    expect(
      passkeyCreateBodySchema.safeParse({ name: "a".repeat(64), response: RESPONSE }).success,
    ).toBe(true);
    expect(
      passkeyCreateBodySchema.safeParse({ name: "a".repeat(65), response: RESPONSE }).success,
    ).toBe(false);
    expect(passkeyCreateBodySchema.safeParse({ name: "   ", response: RESPONSE }).success).toBe(
      false,
    );
  });
});

describe("reauthBodySchema", () => {
  it("is discriminated on method", () => {
    expect(reauthBodySchema.safeParse({ method: "password", password: "pw" }).success).toBe(true);
    expect(reauthBodySchema.safeParse({ method: "totp", code: "123456" }).success).toBe(true);
    expect(reauthBodySchema.safeParse({ method: "recovery", code: "abcde-fghij" }).success).toBe(
      true,
    );
    expect(reauthBodySchema.safeParse({ method: "password", code: "123456" }).success).toBe(false);
    expect(reauthBodySchema.safeParse({ method: "passkey" }).success).toBe(false);
    expect(reauthBodySchema.safeParse({ method: "password", password: "" }).success).toBe(false);
  });
});

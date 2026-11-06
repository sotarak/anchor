import { describe, expect, it } from "vitest";
import { changePasswordBodySchema, resetPasswordBodySchema } from "../../src/schemas/auth";

const STRONG = "a long enough password";

describe("changePasswordBodySchema", () => {
  it("requires currentPassword and a policy-compliant newPassword", () => {
    expect(
      changePasswordBodySchema.safeParse({ currentPassword: "x", newPassword: STRONG }).success,
    ).toBe(true);
    expect(
      changePasswordBodySchema.safeParse({ currentPassword: "", newPassword: STRONG }).success,
    ).toBe(false);
    expect(
      changePasswordBodySchema.safeParse({ currentPassword: "x", newPassword: "short" }).success,
    ).toBe(false);
  });
});

describe("resetPasswordBodySchema", () => {
  it("requires a token and a policy-compliant password", () => {
    expect(resetPasswordBodySchema.safeParse({ token: "t", password: STRONG }).success).toBe(true);
    expect(resetPasswordBodySchema.safeParse({ token: "", password: STRONG }).success).toBe(false);
    expect(resetPasswordBodySchema.safeParse({ token: "t", password: "short" }).success).toBe(
      false,
    );
  });
});

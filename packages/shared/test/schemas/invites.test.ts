import { describe, expect, it } from "vitest";
import {
  acceptInviteBodySchema,
  createInviteBodySchema,
  inviteTokenBodySchema,
} from "../../src/schemas/invites";

describe("invite schemas", () => {
  it("createInvite normalizes the email and requires an instance role", () => {
    expect(createInviteBodySchema.parse({ email: " A@X.io ", role: "member" })).toEqual({
      email: "a@x.io",
      role: "member",
    });
    expect(createInviteBodySchema.safeParse({ email: "a@x.io", role: "viewer" }).success).toBe(
      false,
    );
  });

  it("inviteToken is 1..200 chars", () => {
    expect(inviteTokenBodySchema.safeParse({ token: "" }).success).toBe(false);
    expect(inviteTokenBodySchema.safeParse({ token: "x".repeat(201) }).success).toBe(false);
    expect(inviteTokenBodySchema.safeParse({ token: "anc_inv_x" }).success).toBe(true);
  });

  it("acceptInvite requires name 1..100 and a policy-compliant password", () => {
    const ok = (o: object) =>
      acceptInviteBodySchema.safeParse({
        token: "t",
        name: "Ann",
        password: "a long enough password",
        ...o,
      }).success;
    expect(ok({})).toBe(true);
    expect(ok({ name: "" })).toBe(false);
    expect(ok({ name: "x".repeat(101) })).toBe(false);
    expect(ok({ password: "short" })).toBe(false);
  });
});

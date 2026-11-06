import { describe, expect, it } from "vitest";
import { instanceRoleSchema, updateUserBodySchema } from "../../src/schemas/users";

describe("updateUserBodySchema", () => {
  it("updateUser requires a field", () => {
    expect(updateUserBodySchema.safeParse({}).success).toBe(false);
    expect(updateUserBodySchema.safeParse({ role: "admin" }).success).toBe(true);
    expect(updateUserBodySchema.safeParse({ disabled: true }).success).toBe(true);
  });

  it("rejects unknown roles", () => {
    expect(updateUserBodySchema.safeParse({ role: "root" }).success).toBe(false);
    expect(instanceRoleSchema.options).toEqual(["owner", "admin", "member"]);
  });
});

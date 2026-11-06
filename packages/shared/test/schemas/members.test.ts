import { describe, expect, it } from "vitest";
import {
  addMemberBodySchema,
  projectRoleSchema,
  updateMemberBodySchema,
} from "../../src/schemas/members";

describe("addMemberBodySchema", () => {
  it("addMember rejects admin with environments", () => {
    const base = { email: "a@x.io", role: "admin" };
    expect(addMemberBodySchema.safeParse({ ...base, environments: ["prod"] }).success).toBe(false);
    expect(addMemberBodySchema.safeParse({ ...base, environments: null }).success).toBe(true);
  });

  it("addMember rejects duplicate env slugs", () => {
    const body = { email: "a@x.io", role: "developer", environments: ["dev", "dev"] };
    expect(addMemberBodySchema.safeParse(body).success).toBe(false);
  });

  it("environments defaults to null and must hold 1..50 valid slugs", () => {
    expect(addMemberBodySchema.parse({ email: "a@x.io", role: "viewer" }).environments).toBeNull();
    const env = (environments: unknown) =>
      addMemberBodySchema.safeParse({ email: "a@x.io", role: "viewer", environments }).success;
    expect(env([])).toBe(false);
    expect(env(Array.from({ length: 51 }, (_, i) => `e${i}`))).toBe(false);
    expect(env(["Prod"])).toBe(false);
    expect(env(["dev", "prod"])).toBe(true);
  });

  it("projectRole accepts only admin, developer, viewer", () => {
    for (const r of ["admin", "developer", "viewer"]) expect(projectRoleSchema.parse(r)).toBe(r);
    expect(projectRoleSchema.safeParse("owner").success).toBe(false);
  });
});

describe("updateMemberBodySchema", () => {
  it("requires a field and rejects admin with environments when both are present", () => {
    expect(updateMemberBodySchema.safeParse({}).success).toBe(false);
    expect(updateMemberBodySchema.safeParse({ role: "admin", environments: ["dev"] }).success).toBe(
      false,
    );
    expect(updateMemberBodySchema.safeParse({ role: "admin" }).success).toBe(true);
    expect(updateMemberBodySchema.safeParse({ environments: ["dev"] }).success).toBe(true);
    expect(updateMemberBodySchema.safeParse({ environments: null }).success).toBe(true);
  });
});

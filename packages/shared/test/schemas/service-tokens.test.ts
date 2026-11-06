import { describe, expect, it } from "vitest";
import { createServiceTokenBodySchema } from "../../src/schemas/service-tokens";

const valid = {
  name: "ci",
  permission: "read",
  scopes: [{ environment: "prod", path: "/" }],
  expiresInDays: 30,
};

describe("createServiceTokenBodySchema", () => {
  it("serviceToken requires expiresInDays 1..365", () => {
    const ok = (expiresInDays: unknown) =>
      createServiceTokenBodySchema.safeParse({ ...valid, expiresInDays }).success;
    expect(ok(0)).toBe(false);
    expect(ok(366)).toBe(false);
    expect(ok(1.5)).toBe(false);
    const { expiresInDays: _drop, ...missing } = valid;
    expect(createServiceTokenBodySchema.safeParse(missing).success).toBe(false);
    expect(ok(1)).toBe(true);
    expect(ok(365)).toBe(true);
  });

  it("serviceToken normalizes scope paths", () => {
    const parsed = createServiceTokenBodySchema.parse({
      ...valid,
      scopes: [{ environment: "prod", path: "api/" }],
    });
    expect(parsed.scopes[0]?.path).toBe("/api");
    const bad = { ...valid, scopes: [{ environment: "prod", path: "/../x" }] };
    expect(createServiceTokenBodySchema.safeParse(bad).success).toBe(false);
  });

  it("serviceToken requires at least one scope and at most 20", () => {
    expect(createServiceTokenBodySchema.safeParse({ ...valid, scopes: [] }).success).toBe(false);
    const many = Array.from({ length: 21 }, () => ({ environment: "prod", path: "/" }));
    expect(createServiceTokenBodySchema.safeParse({ ...valid, scopes: many }).success).toBe(false);
  });

  it("permission is read or read-write, name is 1..64", () => {
    const ok = (o: object) => createServiceTokenBodySchema.safeParse({ ...valid, ...o }).success;
    expect(ok({ permission: "read-write" })).toBe(true);
    expect(ok({ permission: "write" })).toBe(false);
    expect(ok({ name: "" })).toBe(false);
    expect(ok({ name: "x".repeat(65) })).toBe(false);
  });
});

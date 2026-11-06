import { describe, expect, it } from "vitest";
import { auditQuerySchema } from "../../src/schemas/audit";

describe("auditQuerySchema", () => {
  it("auditQuery coerces limit and caps at 200", () => {
    expect(auditQuerySchema.parse({ limit: "10" }).limit).toBe(10);
    expect(auditQuerySchema.parse({}).limit).toBe(50);
    expect(auditQuerySchema.safeParse({ limit: "201" }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
  });

  it("action must be a known audit action", () => {
    expect(auditQuerySchema.safeParse({ action: "secret.read" }).success).toBe(true);
    expect(auditQuerySchema.safeParse({ action: "secret.stolen" }).success).toBe(false);
  });

  it("before is 1..200 chars", () => {
    expect(auditQuerySchema.safeParse({ before: "" }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ before: "x".repeat(201) }).success).toBe(false);
  });
});

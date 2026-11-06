import { describe, expect, it } from "vitest";
import { passwordSchema, slugSchema } from "../../src/schemas/common";

describe("slugSchema", () => {
  it.each(["dev", "my-app", "a1"])("accepts %s", (s) => expect(slugSchema.parse(s)).toBe(s));
  it.each(["Dev", "-x", "my_app", "", "a".repeat(64)])("rejects %s", (s) =>
    expect(slugSchema.safeParse(s).success).toBe(false),
  );
});

describe("passwordSchema", () => {
  it("enforces 12..1024 chars", () => {
    expect(passwordSchema.safeParse("a".repeat(11)).success).toBe(false);
    expect(passwordSchema.safeParse("a".repeat(12)).success).toBe(true);
    expect(passwordSchema.safeParse("a".repeat(1025)).success).toBe(false);
  });
});

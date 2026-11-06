import { describe, expect, it } from "vitest";
import {
  normalizeSecretPath,
  passwordSchema,
  secretKeySchema,
  secretValueSchema,
  slugSchema,
} from "../src";

describe("normalizeSecretPath", () => {
  it.each([
    ["", "/"],
    ["/", "/"],
    ["api", "/api"],
    ["/api", "/api"],
    ["/api/", "/api"],
    ["/api/db", "/api/db"],
  ])("%s -> %s", (input, out) => expect(normalizeSecretPath(input)).toBe(out));
  it.each([
    "//",
    "/api//db",
    "/./x",
    "/../x",
    "/a b",
    `/${"a/".repeat(11)}a`,
    `/${"x".repeat(256)}`,
  ])("rejects %s", (input) => expect(() => normalizeSecretPath(input)).toThrow("invalid path"));
});

describe("secretKeySchema", () => {
  it("accepts env-var names and keeps case", () => {
    expect(secretKeySchema.parse("DB_URL")).toBe("DB_URL");
    expect(secretKeySchema.parse("db_url")).toBe("db_url");
    expect(secretKeySchema.parse("_X1")).toBe("_X1");
  });
  it.each(["1ABC", "A-B", "A.B", "", "A".repeat(256)])("rejects %s", (k) =>
    expect(secretKeySchema.safeParse(k).success).toBe(false),
  );
});

describe("slugSchema", () => {
  it.each(["dev", "my-app", "a1"])("accepts %s", (s) => expect(slugSchema.parse(s)).toBe(s));
  it.each(["Dev", "-x", "my_app", "", "a".repeat(64)])("rejects %s", (s) =>
    expect(slugSchema.safeParse(s).success).toBe(false),
  );
});

describe("secretValueSchema", () => {
  it("accepts empty and exactly 65536 bytes", () => {
    expect(secretValueSchema.parse("")).toBe("");
    expect(secretValueSchema.safeParse("a".repeat(65536)).success).toBe(true);
    expect(secretValueSchema.safeParse("é".repeat(32768)).success).toBe(true); // 2 bytes each
  });
  it("rejects 65537 bytes", () => {
    expect(secretValueSchema.safeParse("a".repeat(65537)).success).toBe(false);
    expect(secretValueSchema.safeParse(`${"é".repeat(32768)}a`).success).toBe(false);
  });
});

describe("passwordSchema", () => {
  it("enforces 12..1024 chars", () => {
    expect(passwordSchema.safeParse("a".repeat(11)).success).toBe(false);
    expect(passwordSchema.safeParse("a".repeat(12)).success).toBe(true);
    expect(passwordSchema.safeParse("a".repeat(1025)).success).toBe(false);
  });
});

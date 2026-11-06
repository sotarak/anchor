import { slugSchema } from "@anchor/shared";
import { describe, expect, it } from "vitest";
import { deriveSlug } from "@/lib/slug";

describe("deriveSlug", () => {
  it.each([
    ["My Cool App!", "my-cool-app"],
    ["  Billing   API  ", "billing-api"],
    ["Ünïcode & Co", "n-code-co"],
    ["---", ""],
    ["a".repeat(80), "a".repeat(63)],
    [`${"a".repeat(62)} b`, "a".repeat(62)],
  ])("%j → %j", (name, slug) => {
    expect(deriveSlug(name)).toBe(slug);
  });

  it("every non-empty result is a valid slug", () => {
    for (const name of ["My Cool App!", "X", "9 lives", "a b c", `${"z".repeat(70)}!`]) {
      expect(slugSchema.safeParse(deriveSlug(name)).success).toBe(true);
    }
  });
});

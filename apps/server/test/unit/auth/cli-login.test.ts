import { describe, expect, it } from "vitest";
import { newUserCode } from "#src/auth/cli-login";

describe("newUserCode", () => {
  it("draws XXXX-XXXX codes from the consonant alphabet", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const code = newUserCode();
      expect(code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
      codes.add(code);
    }
    expect(codes.size).toBeGreaterThan(990);
  });
});

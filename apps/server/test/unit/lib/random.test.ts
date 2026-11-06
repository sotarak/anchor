import { describe, expect, it } from "vitest";
import { newSessionToken, newToken, tokenPrefix } from "#src/lib/random";

describe("token helpers", () => {
  it("newToken has prefix and 43 base64url chars", () => {
    expect(newToken("anc_st")).toMatch(/^anc_st_[A-Za-z0-9_-]{43}$/);
    expect(newToken("anc_inv")).toMatch(/^anc_inv_[A-Za-z0-9_-]{43}$/);
    expect(newToken("anc_rst")).toMatch(/^anc_rst_[A-Za-z0-9_-]{43}$/);
    expect(newSessionToken()).toMatch(/^anc_s_[A-Za-z0-9_-]{43}$/);
    expect(newToken("anc_st")).not.toBe(newToken("anc_st"));
  });

  it("tokenPrefix is 12 chars", () => {
    const token = newToken("anc_st");
    expect(tokenPrefix(token)).toBe(token.slice(0, 12));
    expect(tokenPrefix(token)).toHaveLength(12);
  });
});

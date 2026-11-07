import { describe, expect, it } from "vitest";
import { normalizeUserCode, USER_CODE_ALPHABET } from "../src/user-code";

describe("normalizeUserCode", () => {
  it("accepts loose spellings of a code", () => {
    for (const raw of [" wdjbmjht ", "wdjb mjht", "WDJB-MJHT", "wdjb-mjht", "WDJBMJHT"]) {
      expect(normalizeUserCode(raw)).toBe("WDJB-MJHT");
    }
  });
  it("rejects wrong lengths and letters outside the alphabet", () => {
    for (const raw of ["WDJB-MJH", "AEIO-UAEI", "", "WDJB-MJHTX", "WDJB-MJH1"]) {
      expect(normalizeUserCode(raw)).toBeNull();
    }
  });
  it("uses the 20-consonant alphabet", () => {
    expect(USER_CODE_ALPHABET).toBe("BCDFGHJKLMNPQRSTVWXZ");
  });
});

import { describe, expect, it } from "vitest";
import { matchGlob } from "#src/import/glob";

describe("matchGlob", () => {
  it("* and ? match, anchored and case-sensitive, other characters literal", () => {
    expect(matchGlob("CONFIGS_CONTEXT_*", "CONFIGS_CONTEXT_CACHE_TTL")).toBe(true);
    expect(matchGlob("*_TIMEOUT_MS", "X_TIMEOUT_MS")).toBe(true);
    expect(matchGlob("A?C", "ABC")).toBe(true);
    expect(matchGlob("PORT", "PORT")).toBe(true);
    expect(matchGlob("PORT", "APP_PORT")).toBe(false);
    expect(matchGlob("configs_*", "CONFIGS_X")).toBe(false);
    expect(matchGlob("A.B", "AXB")).toBe(false);
    expect(matchGlob("A+(B)", "A+(B)")).toBe(true);
  });
});

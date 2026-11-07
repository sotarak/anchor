import { describe, expect, it } from "vitest";
import { countLabel } from "@/lib/format";

describe("countLabel", () => {
  it("uses the singular for exactly one", () => {
    expect(countLabel(1, "tokens")).toBe("1 token");
    expect(countLabel(1, "results")).toBe("1 result");
  });

  it("keeps the plural for zero and many", () => {
    expect(countLabel(0, "tokens")).toBe("0 tokens");
    expect(countLabel(2, "results")).toBe("2 results");
  });
});

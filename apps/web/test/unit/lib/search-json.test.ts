import { describe, expect, it } from "vitest";
import { parseSearch, stringifySearch } from "@/lib/search-json";

describe("router search parsing", () => {
  it("parses only values whose JSON round trip is exact", () => {
    expect(
      parseSearch(
        `?${new URLSearchParams({ long: "12345678901234567890", exp: "1e3", limit: "50", flag: "true", nil: "null", q: '"quoted"', path: "/a/b" })}`,
      ),
    ).toEqual({
      long: "12345678901234567890",
      exp: "1e3",
      limit: 50,
      flag: true,
      nil: null,
      q: '"quoted"',
      path: "/a/b",
    });
  });

  it.each(["12345678901234567890", "1e3", "true", "null", '"quoted"', "a b+c", "50"])(
    "a value %j survives parse then stringify unchanged",
    (state) => {
      const qs = `?${new URLSearchParams({ state })}`;
      expect(new URLSearchParams(stringifySearch(parseSearch(qs))).get("state")).toBe(state);
    },
  );
});

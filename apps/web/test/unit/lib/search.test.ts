import { describe, expect, it } from "vitest";
import { pathSearch } from "@/lib/search";

describe("pathSearch", () => {
  it.each([
    [{ path: "/api" }, { path: "/api" }],
    [{ path: "api/v1/" }, { path: "/api/v1" }],
    [{ path: "/" }, {}],
    [{ path: "" }, {}],
    [{ path: "../x" }, {}],
    [{ path: 42 }, {}],
    [{}, {}],
  ])("%j → %j", (input, output) => {
    expect(pathSearch(input)).toEqual(output);
  });
});

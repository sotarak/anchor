import { describe, expect, it } from "vitest";
import { ancestors, childSegment, isWithin } from "#src/secrets/paths";

describe("ancestors", () => {
  it.each([
    ["/", []],
    ["/a", ["/a"]],
    ["/a/b/c", ["/a", "/a/b", "/a/b/c"]],
  ])("%s", (path, expected) => {
    expect(ancestors(path)).toEqual(expected);
  });
});

describe("isWithin", () => {
  it.each([
    ["/", "/", true],
    ["/anything/deep", "/", true],
    ["/api", "/api", true],
    ["/api/x", "/api", true],
    ["/apix", "/api", false],
    ["/a_b/c", "/a_b", true],
    ["/axb", "/a_b", false],
    ["/", "/api", false],
    ["/ap", "/api", false],
  ])("isWithin(%s, %s) = %s", (path, prefix, expected) => {
    expect(isWithin(path, prefix)).toBe(expected);
  });
});

describe("childSegment", () => {
  it.each([
    ["/", "/a/b", "a"],
    ["/", "/a", "a"],
    ["/", "/", null],
    ["/a", "/a/b/c", "b"],
    ["/a", "/a", null],
    ["/a", "/ab/c", null],
    ["/a/b", "/a", null],
  ])("childSegment(%s, %s) = %s", (parent, path, expected) => {
    expect(childSegment(parent, path)).toBe(expected);
  });
});

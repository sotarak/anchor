import { describe, expect, it } from "vitest";
import { scopeMatches } from "#src/authz/policy";

describe("scopeMatches", () => {
  it.each([
    ["/", "/x", true],
    ["/", "/", true],
    ["/api", "/api", true],
    ["/api", "/api/db", true],
    ["/api", "/apix", false],
    ["/api", "/", false],
    ["/api/db", "/api", false],
    ["/api/db", "/api/dbx", false],
  ])("scope %s on path %s -> %s", (scope, path, expected) => {
    expect(scopeMatches(scope, path)).toBe(expected);
  });
});

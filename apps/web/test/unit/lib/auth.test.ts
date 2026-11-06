import { describe, expect, it } from "vitest";
import { safeRedirect } from "@/lib/auth";

describe("safeRedirect", () => {
  it.each([
    "/projects",
    "/projects/app/environments/dev?path=%2Fapi",
    "/audit?action=secret.read#top",
  ])("keeps the same-origin path %s", (path) => {
    expect(safeRedirect(path)).toBe(path);
  });

  it.each([
    "//evil.example",
    "https://evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "%2F%2Fevil.example",
    "",
    undefined,
    null,
    42,
    "/\tfoo",
    "/\nfoo",
    "projects",
    "/foo\\bar",
  ])("falls back to /projects for %j", (raw) => {
    expect(safeRedirect(raw)).toBe("/projects");
  });
});

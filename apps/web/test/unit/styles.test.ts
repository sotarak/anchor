// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  fileURLToPath(new URL("../../src/styles/globals.css", import.meta.url)),
  "utf8",
);

describe("global styles", () => {
  // Tailwind 4's preflight gives <button> `cursor: default`; the base layer restores the pointer.
  it("enabled buttons and ARIA controls get a pointer", () => {
    expect(css).toMatch(
      /button:not\(:disabled\)[^{]*\[role="menuitem"\][^{]*\{\s*cursor:\s*pointer/s,
    );
  });

  it("reduced motion removes animation and transition time", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*animation-duration:\s*0\.01ms !important;[^}]*transition-duration:\s*0\.01ms !important;/s,
    );
  });

  it("disabled controls get not-allowed", () => {
    expect(css).toMatch(/:disabled[^{]*\[aria-disabled="true"\][^{]*\{\s*cursor:\s*not-allowed/s);
  });
});

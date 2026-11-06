// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

/** Parses Cloudflare `_headers`: an unindented path line, then indented `Name: value` lines. */
function blocks(): Map<string, string[]> {
  const text = readFileSync(
    fileURLToPath(new URL("../../../public/_headers", import.meta.url)),
    "utf8",
  );
  const out = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of text.split("\n")) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    if (/^\S/.test(line)) {
      current = [];
      out.set(line.trim(), current);
    } else current?.push(line.trim());
  }
  return out;
}

describe("public/_headers", () => {
  it("/* carries the exact CSP and the security headers", () => {
    const all = blocks().get("/*");
    expect(all).toContain(`Content-Security-Policy: ${CSP}`);
    expect(all).toContain("X-Content-Type-Options: nosniff");
    expect(all).toContain("Referrer-Policy: no-referrer");
    expect(all).toContain("X-Frame-Options: DENY");
  });

  it("CSP allows no unsafe-inline or unsafe-eval", () => {
    const csp = blocks()
      .get("/*")
      ?.find((h) => h.startsWith("Content-Security-Policy:"));
    expect(csp).toBeDefined();
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("index.html is revalidated; hashed assets are immutable", () => {
    const b = blocks();
    expect(b.get("/")).toContain("Cache-Control: no-cache");
    expect(b.get("/index.html")).toContain("Cache-Control: no-cache");
    expect(b.get("/assets/*")).toContain("Cache-Control: public, max-age=31536000, immutable");
  });
});

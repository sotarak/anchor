// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const path = (rel: string) => fileURLToPath(new URL(`../../../../../${rel}`, import.meta.url));
const read = (rel: string) => readFileSync(path(rel), "utf8");
const json = (rel: string) => JSON.parse(read(rel));

const PACKAGES = [
  "package.json",
  "apps/cli/package.json",
  "apps/server/package.json",
  "apps/web/package.json",
  "packages/shared/package.json",
];

describe("open-source repository", () => {
  it.each(PACKAGES)("%s declares Apache-2.0", (pkg) => {
    expect(json(pkg).license).toBe("Apache-2.0");
  });

  it.each(["package.json", "apps/cli/package.json"])("%s links the repository", (pkg) => {
    const p = json(pkg);
    expect(p.repository?.url).toBe("https://github.com/sotarak/anchor.git");
    expect(p.homepage).toBe("https://sotarak.github.io/anchor/");
    expect(p.bugs?.url).toBe("https://github.com/sotarak/anchor/issues");
  });

  it("LICENSE is Apache-2.0 with the owner's copyright", () => {
    const text = read("LICENSE");
    expect(text).toContain("Apache License\n                           Version 2.0, January 2004");
    expect(text).toContain("Copyright 2026 Sota");
  });

  it("NOTICE credits the owner and third parties", () => {
    const text = read("NOTICE");
    for (const s of [
      "Copyright 2026 Sota",
      "obra/superpowers",
      "cloudflare/skills",
      "novuhq/novu",
    ]) {
      expect(text).toContain(s);
    }
  });

  it("vendored skill licenses are present", () => {
    const mit = read(".claude/THIRD_PARTY_LICENSES/obra-superpowers-MIT.txt");
    expect(mit).toContain("MIT License");
    expect(mit).toContain("Jesse Vincent");
    expect(existsSync(path(".claude/THIRD_PARTY_LICENSES/cloudflare-skills-Apache-2.0.txt"))).toBe(
      true,
    );
    expect(read(".claude/THIRD_PARTY_LICENSES/cloudflare-skills-Apache-2.0.txt")).toContain(
      "Apache License",
    );
  });
});

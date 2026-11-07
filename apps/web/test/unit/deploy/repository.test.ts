// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const path = (rel: string) => fileURLToPath(new URL(`../../../../../${rel}`, import.meta.url));
const read = (rel: string) => readFileSync(path(rel), "utf8");
const json = (rel: string) => JSON.parse(read(rel));

/** Every file under `rel` (recursively), as repository-relative paths; [] when it does not exist. */
function filesUnder(rel: string): string[] {
  if (!existsSync(path(rel))) return [];
  return readdirSync(path(rel)).flatMap((name) => {
    const child = `${rel}/${name}`;
    return statSync(path(child)).isDirectory() ? filesUnder(child) : [child];
  });
}

const COMMUNITY_FILES = [
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "SUPPORT.md",
  "CHANGELOG.md",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/pull_request_template.md",
  ".github/dependabot.yml",
  ".editorconfig",
];

/** Public prose: community files, the README and the docs site content. */
const publicText = () => [
  ...COMMUNITY_FILES.filter((f) => f.endsWith(".md") || f.endsWith(".yml")),
  "README.md",
  ...filesUnder("apps/docs/src/content"),
];

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;

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

  it.each(COMMUNITY_FILES)("%s exists", (file) => {
    expect(existsSync(path(file))).toBe(true);
  });

  it("community files and docs contain no email address (contact is GitHub-only)", () => {
    for (const file of publicText()) {
      const emails = (read(file).match(EMAIL) ?? []).filter(
        // CONTRIBUTING explains the commit trailer convention, which names this address.
        (e) => !(file === "CONTRIBUTING.md" && e === "noreply@anthropic.com"),
      );
      expect(emails, file).toEqual([]);
    }
  });

  it("docs content and README hold no secret-looking strings", () => {
    for (const file of [...filesUnder("apps/docs/src/content"), "README.md"]) {
      const text = read(file);
      expect(text, file).not.toMatch(/anc_[stp]_[A-Za-z0-9_-]{40,}/);
      expect(text, file).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
    }
  });

  it("the bug report requires removing secrets", () => {
    const form = read(".github/ISSUE_TEMPLATE/bug_report.yml");
    const box = form.slice(form.indexOf("removed secret values"));
    expect(box).toMatch(/^\s*required: true/m);
    expect(box.indexOf("required: true")).toBeLessThan(200);
  });
});

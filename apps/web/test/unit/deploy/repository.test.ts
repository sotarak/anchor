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

// The last domain label is letters, so `setup-action@v0.2.0` and `cli@0.2.0` are not addresses.
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}\b/g;
/** A bearer token of any kind (`anc_s_`, `anc_st_`, `anc_inv_`, `anc_rst_`) at real length. */
const SECRET_LIKE = /anc_(s|st|inv|rst)_[A-Za-z0-9_-]{20,}/;

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
    const novu = read(".claude/THIRD_PARTY_LICENSES/novu-MIT.txt");
    expect(novu).toContain("MIT License");
    expect(novu).toContain("Copyright (c) 2019 Noti-fire Apps Ltd.");
    expect(read("NOTICE")).toContain(".claude/THIRD_PARTY_LICENSES/novu-MIT.txt");
  });

  it.each(COMMUNITY_FILES)("%s exists", (file) => {
    expect(existsSync(path(file))).toBe(true);
  });

  it("the email pattern finds addresses but not package@version specifiers", () => {
    const text =
      "mail dev.name+x@mail.example.io, or uses: sotarak/anchor/setup-action@v0.2.0, npx @anchor-secrets/cli@0.2.0";
    expect(text.match(EMAIL)).toEqual(["dev.name+x@mail.example.io"]);
  });

  it("community files and docs contain no email address (contact is GitHub-only)", () => {
    for (const file of publicText()) {
      const emails = (read(file).match(EMAIL) ?? []).filter(
        (e) =>
          // RFC 2606 example domains are placeholders in examples, not contacts.
          !/@example\.(com|org|net)$/.test(e) &&
          // CONTRIBUTING explains the commit trailer convention, which names this address.
          !(file === "CONTRIBUTING.md" && e === "noreply@anthropic.com"),
      );
      expect(emails, file).toEqual([]);
    }
  });

  it("the secret-string guard catches every bearer token kind", () => {
    // Built at runtime so this file holds no token-shaped literal; 43 chars = base64url(32 bytes).
    const body = "A".repeat(43);
    for (const kind of ["s", "st", "inv", "rst"]) {
      expect(`see anc_${kind}_${body} here`).toMatch(SECRET_LIKE);
    }
    expect("anc_st_<token>").not.toMatch(SECRET_LIKE);
  });

  it("docs content and README hold no secret-looking strings", () => {
    for (const file of [...filesUnder("apps/docs/src/content"), "README.md"]) {
      const text = read(file);
      expect(text, file).not.toMatch(SECRET_LIKE);
      expect(text, file).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
    }
  });

  describe("the security docs do not overstate guarantees", () => {
    const model = () => read("apps/docs/src/content/docs/security/model.md");

    it("a D1 writer is said to be able to grant themselves access", () => {
      const row = model()
        .split("\n")
        .find((l) => l.startsWith("| Can write to D1"));
      expect(row).toMatch(/session/i);
      expect(row).toMatch(/read everything|reads everything/i);
    });

    it("a database copy is said to expose password hashes", () => {
      const row = model()
        .split("\n")
        .find((l) => l.startsWith("| Gets a copy of the D1 database"));
      expect(row).toMatch(/password hashes/i);
    });

    it("token audit coverage is limited to value reads and writes", () => {
      const ci = read("apps/docs/src/content/docs/guides/ci.md");
      expect(model()).not.toMatch(/every use is audited/i);
      expect(ci).not.toMatch(/every read with a token/i);
      expect(model()).toMatch(/value read/i);
    });

    it("no page says the Workers Free plan is enough", () => {
      for (const file of filesUnder("apps/docs/src/content")) {
        expect(read(file), file).not.toMatch(/free tier that covers/i);
      }
    });

    it("root key troubleshooting names both log lines", () => {
      for (const file of [
        "apps/docs/src/content/docs/troubleshooting.md",
        "apps/docs/src/content/docs/operations/root-key-rotation.md",
      ]) {
        expect(read(file), file).toContain("config_error");
        expect(read(file), file).toContain("secret_decrypt_failed");
        expect(read(file), file).toContain("kekVersion");
      }
    });
  });

  it("the bug report requires removing secrets", () => {
    const form = read(".github/ISSUE_TEMPLATE/bug_report.yml");
    const box = form.slice(form.indexOf("removed secret values"));
    expect(box).toMatch(/^\s*required: true/m);
    expect(box.indexOf("required: true")).toBeLessThan(200);
  });

  it("README links resolve", () => {
    const readme = read("README.md");
    const targets = [...readme.matchAll(/\]\(([^)\s]+)\)/g)]
      .map((m) => m[1] as string)
      .filter((t) => !/^(https?:|mailto:|#)/.test(t))
      .map((t) => t.split("#")[0] as string);
    expect(targets.length).toBeGreaterThan(0);
    const missing = targets.filter((t) => !existsSync(path(t)));
    expect(missing).toEqual([]);
  });

  it("every workspace package shares one version and the changelog has its section", () => {
    const manifests = [
      "package.json",
      "apps/server/package.json",
      "apps/web/package.json",
      "apps/cli/package.json",
      "apps/docs/package.json",
      "packages/shared/package.json",
    ];
    const version = json("package.json").version as string;
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    const versions = Object.fromEntries(manifests.map((m) => [m, json(m).version]));
    expect(versions).toEqual(Object.fromEntries(manifests.map((m) => [m, version])));
    const changelog = read("CHANGELOG.md");
    const v = version.replaceAll(".", "\\.");
    expect(changelog).toMatch(new RegExp(`^## \\[${v}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m"));
    expect(changelog.indexOf("## [Unreleased]")).toBeLessThan(changelog.indexOf(`## [${version}]`));
    expect(changelog).toMatch(new RegExp(`^\\[${v}\\]: https://github\\.com/sotarak/anchor/`, "m"));
    expect(changelog).toContain(
      `[Unreleased]: https://github.com/sotarak/anchor/compare/v${version}...HEAD`,
    );
  });

  const MEDIA = ["secrets", "overview", "history", "service-tokens", "audit"]
    .map((n) => `docs/media/${n}.png`)
    .concat("docs/media/cli.gif");
  it.each(MEDIA)("%s exists and is under 1 MB", (f) => {
    expect(existsSync(path(f))).toBe(true);
    expect(statSync(path(f)).size).toBeLessThan(1_000_000);
  });

  it("the README leads with the Deploy button, the paid-plan note and the hero shot", () => {
    const readme = read("README.md");
    const button =
      "[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/sotarak/anchor)";
    expect(readme).toContain(button);
    const near = readme.slice(readme.indexOf(button), readme.indexOf(button) + 400);
    expect(near).toMatch(/Workers Paid/);
    expect(readme.indexOf("docs/media/secrets.png")).toBeLessThan(readme.indexOf("## Why Anchor"));
    for (const m of ["overview", "history", "service-tokens", "audit"]) {
      expect(readme).toContain(`docs/media/${m}.png`);
    }
    expect(readme).toContain("docs/media/cli.gif");
    expect(readme).not.toContain("cd apps/server");
  });

  it("the deploy guide offers the button and a manual path from the repo root", () => {
    const g = read("apps/docs/src/content/docs/guides/deploy.md");
    expect(g).toContain(
      "https://deploy.workers.cloudflare.com/?url=https://github.com/sotarak/anchor",
    );
    expect(g).toMatch(/^## Deploy with the button$/m);
    expect(g).toMatch(/^## Deploy manually$/m);
    expect(g).not.toContain("cd apps/server");
    expect(g).toContain("/setup");
  });

  it("the upgrade guide covers button clones, manual checkouts and every CLI install", () => {
    const u = read("apps/docs/src/content/docs/operations/upgrading.md");
    expect(u).not.toContain("git checkout v0.1.0");
    for (const s of [
      "upstream",
      "npm install -g @anchor-secrets/cli@",
      "brew upgrade anchor",
      "install.sh",
      "setup-action@v",
      "database_id",
    ]) {
      expect(u).toContain(s);
    }
  });

  it("the CLI guide explains upgrade and uninstall", () => {
    expect(read("apps/docs/src/content/docs/guides/cli.md")).toMatch(/^## Upgrade and uninstall$/m);
  });

  it("troubleshooting covers install and deploy failures", () => {
    const t = read("apps/docs/src/content/docs/troubleshooting.md");
    for (const s of ["checksum mismatch", "PATH", "22.19", "Workers Builds", "Free plan"]) {
      expect(t).toContain(s);
    }
  });

  it("the button upgrade path covers a copy with unrelated history", () => {
    const u = read("apps/docs/src/content/docs/operations/upgrading.md");
    expect(u).toContain("refusing to merge unrelated histories");
    expect(u).toContain("--allow-unrelated-histories");
  });

  it("the docs home sends the Deploy action through the guide (paid plan, root key backup)", () => {
    const home = read("apps/docs/src/content/docs/index.mdx");
    expect(home).not.toContain("deploy.workers.cloudflare.com");
    expect(home).toContain("/anchor/guides/deploy/#deploy-with-the-button");
  });

  it("troubleshooting names the errors a failed button build prints", () => {
    const t = read("apps/docs/src/content/docs/troubleshooting.md");
    expect(t).toContain("Couldn't find a D1 DB");
    expect(t).toContain("anchor-reencrypt-dlq");
  });

  it("no doc asks for a setup token any more (only the changelog and upgrade guide mention it)", () => {
    const docs = readdirSync(path("apps/docs/src/content/docs"), { recursive: true })
      .map(String)
      .filter((f) => /\.mdx?$/.test(f))
      .map((f) => `apps/docs/src/content/docs/${f}`)
      .filter((f) => !f.endsWith("operations/upgrading.md"));
    const offenders = [...docs, "README.md", "CONTRIBUTING.md", ".dev.vars.example"].filter((f) =>
      /ANCHOR_SETUP_TOKEN|setup token|setupToken/i.test(read(f)),
    );
    expect(offenders).toEqual([]);
    expect(read("apps/docs/src/content/docs/operations/upgrading.md")).toContain(
      "ANCHOR_SETUP_TOKEN",
    );
  });

  it("the deploy guide says to create the owner right after the deploy, and how to recover", () => {
    const g = read("apps/docs/src/content/docs/guides/deploy.md");
    expect(g).toMatch(/right after the deploy/i);
    expect(g).toMatch(/first account created at `\/setup` owns the\s+(>\s*)?instance/i);
    const t = read("apps/docs/src/content/docs/troubleshooting.md");
    expect(t).toMatch(/^## `\/setup` says the instance already has an owner$/m);
  });

  it("the 0.3.0 changelog tells manual installs to move database_id", () => {
    const c = read("CHANGELOG.md");
    const section = c.slice(c.indexOf("## [0.3.0]"), c.indexOf("## [0.2.0]"));
    expect(section).toMatch(/### Upgrade notes/);
    expect(section).toContain("database_id");
    expect(section).toContain("wrangler.jsonc");
    expect(section).toContain(".dev.vars");
  });

  it("README links the docs site", () => {
    expect(read("README.md")).toContain("https://sotarak.github.io/anchor/");
  });
});

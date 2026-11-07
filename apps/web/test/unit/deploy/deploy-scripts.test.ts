// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../../../../${rel}`, import.meta.url)), "utf8");
const scripts = (pkg: string): Record<string, string> => JSON.parse(read(pkg)).scripts ?? {};

/**
 * pnpm built-in commands run instead of a package script with the same name (`pnpm deploy` is
 * "deploy a package from a workspace"), so a script named like one is unreachable as `pnpm <name>`.
 */
const PNPM_BUILTINS = [
  "add",
  "approve-builds",
  "audit",
  "bin",
  "config",
  "create",
  "deploy",
  "dlx",
  "doctor",
  "env",
  "exec",
  "fetch",
  "import",
  "init",
  "install",
  "link",
  "list",
  "ls",
  "outdated",
  "pack",
  "patch",
  "prune",
  "publish",
  "rebuild",
  "remove",
  "root",
  "setup",
  "store",
  "unlink",
  "update",
  "why",
];

/**
 * The root `deploy` script is for Workers Builds (the Deploy to Cloudflare button pre-fills it);
 * people run `pnpm deploy:worker`, never `pnpm deploy`, which is the pnpm built-in.
 */
const ALLOWED_ROOT_BUILTINS = ["deploy"];

/** Docs and README, where a reader could copy a command. */
function publicDocs(): string[] {
  const walk = (rel: string): string[] =>
    readdirSync(fileURLToPath(new URL(`../../../../../${rel}`, import.meta.url)), {
      withFileTypes: true,
    }).flatMap((e) => (e.isDirectory() ? walk(`${rel}/${e.name}`) : [`${rel}/${e.name}`]));
  return [...walk("apps/docs/src/content"), "README.md"];
}

describe("deploy scripts", () => {
  it.each(["apps/server/package.json", "apps/web/package.json"])(
    "%s has no script shadowed by a pnpm built-in",
    (pkg) => {
      expect(Object.keys(scripts(pkg)).filter((name) => PNPM_BUILTINS.includes(name))).toEqual([]);
    },
  );

  it("the root shadows no pnpm built-in except the Workers Builds deploy script", () => {
    const shadowed = Object.keys(scripts("package.json")).filter((n) => PNPM_BUILTINS.includes(n));
    expect(shadowed).toEqual(ALLOWED_ROOT_BUILTINS);
  });

  it("no doc tells anyone to run bare `pnpm deploy` (the pnpm built-in)", () => {
    for (const file of publicDocs()) {
      expect(read(file), file).not.toMatch(/(^|\s)pnpm deploy(\s|$)/m);
    }
  });

  it("the `pnpm <script>` commands in the deploy guide's Deploy section are root scripts", () => {
    // That section runs "from the repository root"; other sections run inside a package.
    const section =
      read("apps/docs/src/content/docs/guides/deploy.md")
        .split(/^## Deploy manually$/m)[1]
        ?.split(/^## /m)[0] ?? "";
    const commands = [...section.matchAll(/^pnpm ([\w:-]+)\s*$/gm)].map((m) => m[1]);
    expect(commands.length).toBeGreaterThan(0);
    for (const name of commands) {
      expect(PNPM_BUILTINS, `docs run \`pnpm ${name}\`, a pnpm built-in`).not.toContain(name);
      expect(Object.keys(scripts("package.json"))).toContain(name);
    }
  });

  it("deploy:worker builds the dashboard, then runs the root deploy script", () => {
    expect(scripts("package.json")["deploy:worker"]).toBe("pnpm build && pnpm run deploy");
    expect(scripts("apps/server/package.json")["deploy:worker"]).toBeUndefined();
  });
});

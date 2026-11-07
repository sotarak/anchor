// @vitest-environment node
// What the Deploy to Cloudflare button needs from the repository root
// (https://developers.cloudflare.com/workers/platform/deploy-buttons/).
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const path = (rel: string) => fileURLToPath(new URL(`../../../../../${rel}`, import.meta.url));
const read = (rel: string) => readFileSync(path(rel), "utf8");

type Binding = { description?: string };
type RootPackage = {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
  cloudflare?: { bindings?: Record<string, Binding> };
};

function wranglerConfig() {
  const { config, error } = ts.parseConfigFileTextToJson("wrangler.jsonc", read("wrangler.jsonc"));
  if (error) throw new Error(String(error.messageText));
  return config;
}
const rootPkg = (): RootPackage => JSON.parse(read("package.json"));

describe("Deploy to Cloudflare button", () => {
  it("the Worker config lives at the repository root only", () => {
    expect(existsSync(path("wrangler.jsonc"))).toBe(true);
    expect(existsSync(path("apps/server/wrangler.jsonc"))).toBe(false);
  });

  it("the root config points into the workspace", () => {
    const cfg = wranglerConfig();
    expect(cfg.main).toBe("apps/server/src/index.ts");
    expect(cfg.assets.directory).toBe("apps/web/dist");
    // No database_id: the button provisions the database and writes the id into the clone.
    expect(cfg.d1_databases).toEqual([
      { binding: "DB", database_name: "anchor", migrations_dir: "apps/server/migrations" },
    ]);
    expect(cfg.queues.consumers[0].dead_letter_queue).toBe("anchor-reencrypt-dlq");
  });

  it("the setup page asks for exactly one secret, the root key, described", () => {
    const keys = read(".dev.vars.example")
      .split("\n")
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => l.slice(0, l.indexOf("=")));
    expect(keys).toEqual(["ANCHOR_ROOT_KEY"]);
    expect(read(".dev.vars.example")).not.toContain("ANCHOR_SETUP_TOKEN");
    const bindings = rootPkg().cloudflare?.bindings ?? {};
    expect(Object.keys(bindings)).toEqual(["ANCHOR_ROOT_KEY"]);
    for (const k of keys) {
      expect(bindings[k]?.description, k).toContain("openssl rand -base64 32");
    }
    expect(bindings.ANCHOR_ROOT_KEY?.description).toMatch(/back (it )?up/i);
    expect(existsSync(path("apps/server/.dev.vars.example"))).toBe(false);
  });

  it("the deploy script migrates through the binding, then deploys", () => {
    const pkg = rootPkg();
    expect(pkg.scripts.deploy).toBe("wrangler d1 migrations apply DB --remote && wrangler deploy");
    expect(pkg.devDependencies.wrangler).toBeDefined();
  });

  it("the deploy script uses no pnpm", () => {
    // Workers Builds may run it through npm.
    expect(rootPkg().scripts.deploy).not.toMatch(/\bpnpm\b/);
  });
});

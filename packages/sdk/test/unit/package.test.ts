import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const root = JSON.parse(readFileSync(new URL("../../../../package.json", import.meta.url), "utf8"));

it("ships ESM and CommonJS, each with its own types", () => {
  const dot = pkg.exports["."];
  expect(dot.import).toEqual({ types: "./dist/index.d.ts", default: "./dist/index.js" });
  expect(dot.require).toEqual({ types: "./dist/index.d.cts", default: "./dist/index.cjs" });
  expect(pkg.files).toEqual(["dist"]);
});

it("runs on Node 20 without runtime dependencies", () => {
  expect(pkg.engines.node).toBe(">=20");
  expect(pkg.dependencies ?? {}).toEqual({});
  expect(pkg.peerDependencies ?? {}).toEqual({});
});

it("is a public package at the workspace version", () => {
  expect(pkg.name).toBe("@anchor-secrets/sdk");
  expect(pkg.version).toBe("0.5.1");
  expect(pkg.version).toBe(root.version);
  expect(pkg.private).toBeUndefined();
  expect(pkg.publishConfig).toEqual({ access: "public" });
  expect(pkg.license).toBe("Apache-2.0");
});

it("emits one declaration pair per source module", () => {
  const dir = new URL("../../", import.meta.url);
  execFileSync(process.execPath, ["build.mjs"], { cwd: dir, stdio: "pipe" });
  const dist = (name: string) => new URL(`dist/${name}`, dir);
  expect(existsSync(dist("client.d.ts"))).toBe(true);
  expect(existsSync(dist("client.d.cts"))).toBe(true);
  expect(readFileSync(dist("index.d.cts"), "utf8")).toContain('"./client.cjs"');
  expect(readFileSync(dist("index.d.ts"), "utf8")).toContain('"./client.js"');
}, 60_000);

import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const root = JSON.parse(readFileSync(new URL("../../../../package.json", import.meta.url), "utf8"));
const NEST = "^10.0.0 || ^11.0.0 || ^12.0.0";

it("declares Nest 10 to 12 and its runtime companions as peers", () => {
  expect(pkg.peerDependencies["@nestjs/common"]).toBe(NEST);
  expect(pkg.peerDependencies["@nestjs/core"]).toBe(NEST);
  expect(Object.keys(pkg.peerDependencies).sort()).toEqual([
    "@nestjs/common",
    "@nestjs/core",
    "reflect-metadata",
    "rxjs",
  ]);
});

it("depends only on the SDK at runtime", () => {
  expect(pkg.dependencies).toEqual({ "@anchor-secrets/sdk": "workspace:*" });
});

it("ships ESM and CommonJS, each with its own types", () => {
  const dot = pkg.exports["."];
  expect(dot.import).toEqual({ types: "./dist/index.d.ts", default: "./dist/index.js" });
  expect(dot.require).toEqual({ types: "./dist/index.d.cts", default: "./dist/index.cjs" });
  expect(pkg.files).toEqual(["dist"]);
});

it("is a public package for Node 20 at the workspace version", () => {
  expect(pkg.name).toBe("@anchor-secrets/nestjs");
  expect(pkg.engines.node).toBe(">=20");
  expect(pkg.version).toBe("0.5.3");
  expect(pkg.version).toBe(root.version);
  expect(pkg.private).toBeUndefined();
  expect(pkg.publishConfig).toEqual({ access: "public" });
});

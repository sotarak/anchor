// Builds the npm package: dist/index.js (ESM), dist/index.cjs (CommonJS) and their types. Every
// import stays external: Nest and its companions are peers, the SDK a dependency.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { emitDualDeclarations } from "../../scripts/dual-declarations.mjs";
import { esbuildOptions as common } from "./esbuild.config.mjs";

const dist = new URL("./dist/", import.meta.url);
if (!existsSync(new URL("../sdk/dist/index.d.ts", import.meta.url))) {
  throw new Error("Build @anchor-secrets/sdk first (pnpm --filter @anchor-secrets/sdk build)");
}
await rm(dist, { recursive: true, force: true });
await mkdir(dist);

await build({ ...common, format: "esm", outfile: new URL("index.js", dist).pathname });
await build({ ...common, format: "cjs", outfile: new URL("index.cjs", dist).pathname });

// One declaration pair per source file (see scripts/dual-declarations.mjs).
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
execFileSync(
  process.execPath,
  [tsc, "-p", new URL("./tsconfig.build.json", import.meta.url).pathname],
  {
    stdio: "inherit",
  },
);
const typesDir = new URL(".types/", dist);
await emitDualDeclarations({ typesDir, distDir: dist });
await rm(typesDir, { recursive: true, force: true });
await copyFile(new URL("../../NOTICE", import.meta.url), new URL("NOTICE", dist));

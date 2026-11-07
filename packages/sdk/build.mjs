// Builds the npm package: dist/index.js (ESM), dist/index.cjs (CommonJS) and their types.
// `@anchor/shared` is bundled, so the package has no runtime dependencies.
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { emitDualDeclarations } from "../../scripts/dual-declarations.mjs";

const dist = new URL("./dist/", import.meta.url);
const entry = new URL("./src/index.ts", import.meta.url).pathname;
await rm(dist, { recursive: true, force: true });
await mkdir(dist);

const common = {
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  target: "node20",
  legalComments: "none",
  logLevel: "warning",
};
await build({ ...common, format: "esm", outfile: new URL("index.js", dist).pathname });
await build({ ...common, format: "cjs", outfile: new URL("index.cjs", dist).pathname });

// One declaration pair per source module; none may import the bundled @anchor/shared.
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
execFileSync(
  process.execPath,
  [tsc, "-p", new URL("./tsconfig.build.json", import.meta.url).pathname],
  { stdio: "inherit" },
);
const typesDir = new URL(".types/", dist);
await emitDualDeclarations({ typesDir, distDir: dist, forbid: ["@anchor/shared"] });
await rm(typesDir, { recursive: true, force: true });
await copyFile(new URL("../../NOTICE", import.meta.url), new URL("NOTICE", dist));

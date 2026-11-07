// Builds the npm package: dist/index.js (ESM), dist/index.cjs (CommonJS) and their types.
// `@anchor/shared` is bundled, so the package has no runtime dependencies.
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";

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

// The declaration file imports nothing (public types never come from @anchor/shared), so the same
// file serves both module formats.
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
execFileSync(
  process.execPath,
  [tsc, "-p", new URL("./tsconfig.build.json", import.meta.url).pathname],
  {
    stdio: "inherit",
  },
);
const types = await readFile(new URL(".types/index.d.ts", dist), "utf8");
if (/^\s*(import|export .* from)\b/m.test(types)) {
  throw new Error("dist/index.d.ts must be self-contained");
}
await writeFile(new URL("index.d.ts", dist), types);
await writeFile(new URL("index.d.cts", dist), types);
await rm(new URL(".types/", dist), { recursive: true, force: true });
await copyFile(new URL("../../NOTICE", import.meta.url), new URL("NOTICE", dist));

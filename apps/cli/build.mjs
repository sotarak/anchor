// Bundles the CLI into one ESM file for Node (dist/anchor.mjs). Release binaries use
// `bun build --compile` instead (.github/workflows/release-cli.yml).
import { chmod, copyFile, readFile } from "node:fs/promises";
import { build } from "esbuild";

const pkg = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
const outfile = new URL("./dist/anchor.mjs", import.meta.url).pathname;

await build({
  entryPoints: [new URL("./src/bin.ts", import.meta.url).pathname],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // The `#!/usr/bin/env node` line comes from src/bin.ts (esbuild keeps the entry's hashbang).
  // Some bundled dependencies are CommonJS and call require() for Node built-ins.
  banner: {
    js: [
      'import { createRequire as __anchorCreateRequire } from "node:module";',
      "const require = __anchorCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  define: { ANCHOR_CLI_VERSION: JSON.stringify(pkg.version) },
  legalComments: "none",
  logLevel: "warning",
});
await chmod(outfile, 0o755);
// The npm package carries the Apache-2.0 NOTICE. (`pnpm pack` adds the root LICENSE itself.)
await copyFile(new URL("../../NOTICE", import.meta.url), new URL("./dist/NOTICE", import.meta.url));

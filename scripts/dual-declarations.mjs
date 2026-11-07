// Copies tsc's per-file declarations into a package's dist twice: `x.d.ts` for ESM and `x.d.cts`
// for CommonJS, whose relative imports point at `.cjs` so CommonJS resolution stays on CommonJS
// typings. Used by the SDK and NestJS package builds.
import { readdir, readFile, writeFile } from "node:fs/promises";

const IMPORT_SPECIFIER = /\bfrom\s+(["'])([^"']+)\1|\bimport\s*\(\s*(["'])([^"']+)\3\s*\)/g;
const RELATIVE_JS = /(["'])(\.\.?\/[^"']+)\.js\1/g;

/**
 * @param {{ typesDir: URL, distDir: URL, forbid?: string[] }} options
 * @returns {Promise<string[]>} the file names written to distDir
 */
export async function emitDualDeclarations({ typesDir, distDir, forbid = [] }) {
  const written = [];
  for (const name of await readdir(typesDir)) {
    if (!name.endsWith(".d.ts")) continue;
    const text = await readFile(new URL(name, typesDir), "utf8");
    for (const match of text.matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[2] ?? match[4];
      if (forbid.some((prefix) => specifier.startsWith(prefix))) {
        throw new Error(`${name} imports ${specifier}`);
      }
    }
    await writeFile(new URL(name, distDir), text);
    await writeFile(
      new URL(name.replace(/\.d\.ts$/, ".d.cts"), distDir),
      text.replace(RELATIVE_JS, "$1$2.cjs$1"),
    );
    written.push(name, name.replace(/\.d\.ts$/, ".d.cts"));
  }
  return written;
}

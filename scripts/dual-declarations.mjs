// Copies tsc's per-file declarations into a package's dist twice: `x.d.ts` for ESM and `x.d.cts`
// for CommonJS, whose relative imports point at `.cjs` so CommonJS resolution stays on CommonJS
// typings. Used by the SDK and NestJS package builds.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

const IMPORT_SPECIFIER = /\bfrom\s+(["'])([^"']+)\1|\bimport\s*\(\s*(["'])([^"']+)\3\s*\)/g;
const RELATIVE_JS = /(["'])(\.\.?\/[^"']+)\.js\1/g;

/**
 * Walks typesDir, subdirectories included, and keeps their layout under distDir.
 *
 * @param {{ typesDir: URL, distDir: URL, forbid?: string[] }} options
 * @returns {Promise<string[]>} the file names written, relative to distDir
 */
export async function emitDualDeclarations({ typesDir, distDir, forbid = [] }) {
  const written = [];
  const walk = async (rel) => {
    for (const entry of await readdir(new URL(rel, typesDir), { withFileTypes: true })) {
      const name = `${rel}${entry.name}`;
      if (entry.isDirectory()) {
        await walk(`${name}/`);
        continue;
      }
      if (!entry.name.endsWith(".d.ts")) continue;
      const text = await readFile(new URL(name, typesDir), "utf8");
      for (const match of text.matchAll(IMPORT_SPECIFIER)) {
        const specifier = match[2] ?? match[4];
        if (forbid.some((prefix) => specifier.startsWith(prefix))) {
          throw new Error(`${name} imports ${specifier}`);
        }
      }
      const twin = name.replace(/\.d\.ts$/, ".d.cts");
      await mkdir(new URL(rel || "./", distDir), { recursive: true });
      await writeFile(new URL(name, distDir), text);
      await writeFile(new URL(twin, distDir), text.replace(RELATIVE_JS, "$1$2.cjs$1"));
      written.push(name, twin);
    }
  };
  await walk("");
  return written;
}

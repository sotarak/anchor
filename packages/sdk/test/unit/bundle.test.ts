import { build } from "esbuild";
import { expect, it } from "vitest";

it("bundles the shared decoder without zod or the rest of @anchor/shared", async () => {
  const result = await build({
    entryPoints: [new URL("../../src/index.ts", import.meta.url).pathname],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    metafile: true,
    logLevel: "silent",
  });
  const inputs = Object.keys(result.metafile.inputs);
  expect(inputs.filter((p) => p.includes("node_modules/zod"))).toEqual([]);
  expect(inputs.filter((p) => p.includes("shared/src/schemas"))).toEqual([]);
  expect(result.outputFiles[0]?.text.length).toBeLessThan(20_000);
});

it("keeps dist/index.js under 16 KB", async () => {
  const result = await build({
    entryPoints: [new URL("../../src/index.ts", import.meta.url).pathname],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    legalComments: "none",
    write: false,
    logLevel: "silent",
  });
  expect(result.outputFiles[0]?.contents.byteLength).toBeLessThan(16 * 1024);
});

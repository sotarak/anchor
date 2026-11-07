import { build } from "esbuild";
import { expect, it } from "vitest";
// @ts-expect-error: plain JavaScript module without types
import { esbuildOptions } from "../../esbuild.config.mjs";

it("bundles only this package's source and imports the SDK from npm", async () => {
  const { metafile } = await build({
    ...esbuildOptions,
    format: "esm",
    write: false,
    metafile: true,
    logLevel: "silent",
  });
  if (!metafile) throw new Error("esbuild returned no metafile");
  const inputs = Object.keys(metafile.inputs);
  expect(inputs.every((p) => p.startsWith("src/"))).toBe(true);
  const imports = Object.values(metafile.outputs)[0]?.imports.map((i) => i.path);
  expect(imports).toContain("@anchor-secrets/sdk");
  expect(imports?.some((p) => p.startsWith("@anchor/"))).toBe(false);
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { emitDualDeclarations } from "./dual-declarations.mjs";

async function dirs(files) {
  const root = await mkdtemp(join(tmpdir(), "dual-decl-"));
  const typesDir = pathToFileURL(`${root}/types/`);
  const distDir = pathToFileURL(`${root}/dist/`);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(typesDir, { recursive: true });
  await mkdir(distDir, { recursive: true });
  for (const [name, text] of Object.entries(files)) await writeFile(new URL(name, typesDir), text);
  return { typesDir, distDir };
}
const read = (dir, name) => readFile(new URL(name, dir), "utf8");

test("writes .d.cts twins with relative imports pointing at .cjs", async () => {
  const { typesDir, distDir } = await dirs({
    "a.d.ts": 'export * from "./b.js";\nimport type { X } from "../c.js";\nexport type Y = X;\n',
  });
  const names = await emitDualDeclarations({ typesDir, distDir });
  assert.deepEqual(names.sort(), ["a.d.cts", "a.d.ts"]);
  assert.match(await read(distDir, "a.d.cts"), /"\.\/b\.cjs"/);
  assert.match(await read(distDir, "a.d.cts"), /"\.\.\/c\.cjs"/);
  assert.match(await read(distDir, "a.d.ts"), /"\.\/b\.js"/);
});

test("leaves package specifiers alone", async () => {
  const { typesDir, distDir } = await dirs({
    "m.d.ts":
      'import type { DynamicModule } from "@nestjs/common";\nexport type D = DynamicModule;\n',
  });
  await emitDualDeclarations({ typesDir, distDir });
  assert.match(await read(distDir, "m.d.cts"), /from "@nestjs\/common"/);
});

test("refuses a forbidden import", async () => {
  const { typesDir, distDir } = await dirs({
    "a.d.ts": 'import type { V } from "@anchor/shared/value-decode";\nexport type W = V;\n',
  });
  await assert.rejects(
    emitDualDeclarations({ typesDir, distDir, forbid: ["@anchor/shared"] }),
    /a\.d\.ts imports @anchor\/shared\/value-decode/,
  );
});

test("ignores files that are not declarations", async () => {
  const { typesDir, distDir } = await dirs({ "a.d.ts": "export {};\n", "a.js.map": "{}" });
  assert.deepEqual((await emitDualDeclarations({ typesDir, distDir })).sort(), [
    "a.d.cts",
    "a.d.ts",
  ]);
});

test("declarations in subdirectories are emitted with the same relative layout, with .cjs imports in the .d.cts twin", async () => {
  const { typesDir, distDir } = await dirs({ "a.d.ts": "export {};\n" });
  const { mkdir } = await import("node:fs/promises");
  await mkdir(new URL("sub/", typesDir), { recursive: true });
  await writeFile(new URL("sub/x.d.ts", typesDir), 'export * from "./y.js";\n');
  const names = await emitDualDeclarations({ typesDir, distDir });
  assert.ok(names.includes("sub/x.d.ts"), names.join(", "));
  assert.ok(names.includes("sub/x.d.cts"), names.join(", "));
  assert.match(await read(distDir, "sub/x.d.ts"), /"\.\/y\.js"/);
  assert.match(await read(distDir, "sub/x.d.cts"), /"\.\/y\.cjs"/);
});

test("the forbid check applies to declarations in subdirectories", async () => {
  const { typesDir, distDir } = await dirs({});
  const { mkdir } = await import("node:fs/promises");
  await mkdir(new URL("sub/", typesDir), { recursive: true });
  await writeFile(new URL("sub/x.d.ts", typesDir), 'import type { V } from "@anchor/shared";\n');
  await assert.rejects(
    emitDualDeclarations({ typesDir, distDir, forbid: ["@anchor/shared"] }),
    /sub\/x\.d\.ts imports @anchor\/shared/,
  );
});

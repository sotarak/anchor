// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";

const script = fileURLToPath(new URL("../../../scripts/lint-tokens.mjs", import.meta.url));

function lint(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "lint-tokens-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  const r = spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}

describe("lint-tokens", () => {
  it("flags raw palette colors, arbitrary text sizes and uppercase with file:line", () => {
    const r = lint({
      "bad.tsx": [
        'export const A = () => <div className="bg-gray-100" />;',
        'export const B = () => <p className="text-[13px]" />;',
        'export const C = () => <th className="uppercase" />;',
      ].join("\n"),
    });
    expect(r.code).toBe(1);
    expect(r.out.match(/bad\.tsx:\d+/g)).toEqual(["bad.tsx:1", "bad.tsx:2", "bad.tsx:3"]);
  });

  it("accepts token utilities including neutral-alpha", () => {
    const r = lint({
      "ok.tsx":
        'export const A = () => <div className="bg-bg-weak text-label-sm bg-neutral-alpha-100" />;',
    });
    expect(r.code).toBe(0);
  });

  it("ignores styles/globals.css and non-tsx/css files", () => {
    const r = lint({
      "styles/globals.css": ".x { color: red } /* bg-gray-100 uppercase */",
      "notes.md": "bg-gray-100",
    });
    expect(r.code).toBe(0);
  });

  it("flags the middle dot separator", () => {
    const r = lint({ "title.tsx": "export const t = (a: string, b: string) => `${a} · ${b}`;" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("title.tsx:1: middle dot (use layout, a breadcrumb or words)");
  });

  it("flags cursor-default", () => {
    const r = lint({ "menu.tsx": 'export const A = () => <div className="cursor-default" />;' });
    expect(r.code).toBe(1);
    expect(r.out).toContain("menu.tsx:1: cursor-default");
  });
});

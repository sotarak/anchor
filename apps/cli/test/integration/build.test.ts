import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../..", import.meta.url));
const bundle = fileURLToPath(new URL("../../dist/anchor.mjs", import.meta.url));

async function anchor(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [bundle, ...args], {
      env: { PATH: process.env.PATH, NO_COLOR: "1", HOME: root },
    });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code: number; stdout: string; stderr: string };
    return { code: err.code, stdout: err.stdout, stderr: err.stderr };
  }
}

describe("node bundle", () => {
  beforeAll(async () => {
    await run(process.execPath, ["build.mjs"], { cwd: root });
  }, 60_000);

  it("prints the package version", async () => {
    const pkg = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as {
      version: string;
    };
    const r = await anchor(["--version"]);
    expect(r).toEqual({ code: 0, stdout: `${pkg.version}\n`, stderr: "" });
  });

  it("is a single executable file with a node shebang", async () => {
    expect((await readFile(bundle, "utf8")).startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  it("keeps the argv guard", async () => {
    const r = await anchor(["secrets", "set", "X=1"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Secret values are not accepted as command-line arguments");
    expect(r.stderr).not.toContain("X=1");
  });

  it("renders help", async () => {
    const r = await anchor(["secrets", "set", "--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Usage: anchor secrets set [options] <key>");
  });
});

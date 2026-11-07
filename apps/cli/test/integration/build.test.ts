import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

// Kept in this file on purpose: vitest runs files in parallel, and `pnpm pack` runs `prepack`
// (the bundle build), so only one file may write dist/.
describe("npm package", () => {
  let tmp: string;
  let tarball: string;
  let pkg: { version: string };

  async function listFiles(dir: string, prefix = ""): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) out.push(...(await listFiles(join(dir, entry.name), rel)));
      else out.push(rel);
    }
    return out;
  }

  beforeAll(async () => {
    pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
    tmp = await mkdtemp(join(tmpdir(), "anchor-pack-"));
    await run("pnpm", ["pack", "--pack-destination", tmp], { cwd: root });
    const tgz = (await readdir(tmp)).filter((f) => f.endsWith(".tgz"));
    expect(tgz).toHaveLength(1);
    tarball = join(tmp, tgz[0] as string);
    await run("tar", ["-xzf", tarball, "-C", tmp]);
  }, 120_000);

  afterAll(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it("ships only the bundle, license files, README and manifest", async () => {
    // pnpm pack adds the workspace root LICENSE itself; build.mjs copies NOTICE into dist/.
    expect((await listFiles(join(tmp, "package"))).sort()).toEqual([
      "LICENSE",
      "README.md",
      "dist/NOTICE",
      "dist/anchor.mjs",
      "package.json",
    ]);
  });

  it("has a publishable manifest with no runtime dependencies", async () => {
    const m = JSON.parse(await readFile(join(tmp, "package/package.json"), "utf8"));
    expect(m.name).toBe("@anchor-secrets/cli");
    expect(m.private).toBeUndefined();
    expect(m.dependencies).toBeUndefined();
    expect(m.bin).toEqual({ anchor: "dist/anchor.mjs", "anchor-secrets": "dist/anchor.mjs" });
    expect(m.publishConfig).toEqual({ access: "public" });
    expect(JSON.stringify(m)).not.toContain("workspace:");
  });

  it.skipIf(process.platform === "win32")(
    "installs globally and runs as both commands",
    async () => {
      const prefix = join(tmp, "prefix");
      await run("npm", [
        "install",
        "-g",
        "--prefix",
        prefix,
        tarball,
        "--offline",
        "--no-audit",
        "--no-fund",
      ]);
      for (const bin of ["anchor", "anchor-secrets"]) {
        const { stdout } = await run(join(prefix, "bin", bin), ["--version"]);
        expect(stdout).toBe(`${pkg.version}\n`);
      }
    },
    120_000,
  );
});

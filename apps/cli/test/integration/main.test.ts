import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTestIo, runCli } from "#test/support";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  version: string;
};

describe("main", () => {
  it("--version prints the version on stdout and exits 0", async () => {
    const io = createTestIo();
    expect(await runCli(["--version"], { io })).toBe(0);
    expect(io.out()).toBe(`${pkg.version}\n`);
    expect(io.err()).toBe("");
  });

  it("--help exits 0 and writes help to stdout", async () => {
    const io = createTestIo();
    expect(await runCli(["--help"], { io })).toBe(0);
    expect(io.out()).toContain("Usage: anchor");
  });

  it("unknown command exits 2 with the usage error on stderr and empty stdout", async () => {
    const io = createTestIo();
    expect(await runCli(["nope"], { io })).toBe(2);
    expect(io.err()).toMatch(/^error: .*nope/);
    expect(io.out()).toBe("");
  });

  it("unexpected exception exits 1 without a stack trace unless --debug", async () => {
    const boom = () => {
      const io = createTestIo();
      io.stdout.write = () => {
        throw new Error("boom");
      };
      return io;
    };
    const plain = boom();
    expect(await runCli(["--version"], { io: plain })).toBe(1);
    expect(plain.err()).toBe("error: Unexpected error (run with --debug for details)\n");

    const debug = boom();
    expect(await runCli(["--debug", "--version"], { io: debug })).toBe(1);
    expect(debug.err()).toContain("error: Unexpected error (run with --debug for details)");
    expect(debug.err()).toContain("Error: boom");
    expect(debug.err()).toMatch(/\n\s+at /);
  });
});

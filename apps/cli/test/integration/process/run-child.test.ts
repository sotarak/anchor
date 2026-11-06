import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import crossSpawn from "cross-spawn";
import { describe, expect, it } from "vitest";
import { CliError } from "#src/errors";
import { createNodeRunChild, exitCodeFromChild, spawnFor } from "#src/process/run-child";
import { tmpDir } from "#test/support";

const fixture = fileURLToPath(new URL("../../support/fixtures/child.mjs", import.meta.url));
const baseEnv = { PATH: process.env.PATH ?? "" };

async function until(cond: () => boolean, ms = 5000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe.skipIf(process.platform === "win32")("createNodeRunChild (real processes)", () => {
  it("propagates child exit code 3", async () => {
    const r = await createNodeRunChild(new EventEmitter())(
      process.execPath,
      [fixture, "exit:3"],
      baseEnv,
    );
    expect(r).toEqual({ code: 3, signal: null });
    expect(exitCodeFromChild(r)).toBe(3);
  });

  it("emitting SIGTERM on the fake proc forwards to the child and resolves with 42", async () => {
    const proc = new EventEmitter();
    const ready = join(await tmpDir(), "ready");
    const running = createNodeRunChild(proc)(process.execPath, [fixture, "wait"], {
      ...baseEnv,
      READY_FILE: ready,
    });
    await until(() => existsSync(ready));
    expect(proc.listenerCount("SIGTERM")).toBe(1);
    proc.emit("SIGTERM", "SIGTERM");
    const r = await running;
    expect(exitCodeFromChild(r)).toBe(42);
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) expect(proc.listenerCount(sig)).toBe(0);
  });

  it("with forwardSigint false (terminal: the child already got Ctrl-C), SIGINT is absorbed, not sent twice", async () => {
    const proc = new EventEmitter();
    const ready = join(await tmpDir(), "ready");
    const running = createNodeRunChild(proc, { forwardSigint: false })(
      process.execPath,
      [fixture, "wait"],
      { ...baseEnv, READY_FILE: ready },
    );
    await until(() => existsSync(ready));
    expect(proc.listenerCount("SIGINT")).toBe(1);
    proc.emit("SIGINT", "SIGINT");
    await new Promise((r) => setTimeout(r, 200));
    proc.emit("SIGTERM", "SIGTERM");
    // Had SIGINT been forwarded, the child (no SIGINT handler) would have died with 130.
    expect(exitCodeFromChild(await running)).toBe(42);
  });

  it("with forwardSigint true (no terminal), SIGINT is forwarded -> 130", async () => {
    const proc = new EventEmitter();
    const ready = join(await tmpDir(), "ready");
    const running = createNodeRunChild(proc, { forwardSigint: true })(
      process.execPath,
      [fixture, "wait"],
      { ...baseEnv, READY_FILE: ready },
    );
    await until(() => existsSync(ready));
    proc.emit("SIGINT", "SIGINT");
    expect(exitCodeFromChild(await running)).toBe(130);
  });

  it("child killed by SIGKILL -> exitCodeFromChild 137", async () => {
    const r = await createNodeRunChild(new EventEmitter())(
      process.execPath,
      [fixture, "kill-self:SIGKILL"],
      baseEnv,
    );
    expect(r).toEqual({ code: null, signal: "SIGKILL" });
    expect(exitCodeFromChild(r)).toBe(137);
  });

  it("nonexistent command -> CliError 127", async () => {
    const proc = new EventEmitter();
    const e = await createNodeRunChild(proc)("anchor-no-such-command-xyz", [], baseEnv).catch(
      (err: unknown) => err,
    );
    expect(e).toBeInstanceOf(CliError);
    expect((e as CliError).exitCode).toBe(127);
    expect((e as CliError).message).toBe("Command not found: anchor-no-such-command-xyz");
    expect(proc.listenerCount("SIGINT")).toBe(0);
  });

  it("child sees injected env", async () => {
    const r = await createNodeRunChild(new EventEmitter())(
      process.execPath,
      [fixture, "expect-env:DB_URL=postgres://u:p@h/db"],
      { ...baseEnv, DB_URL: "postgres://u:p@h/db" },
    );
    expect(r.code).toBe(0);
  });
});

describe("spawnFor", () => {
  it("uses cross-spawn on Windows (PATHEXT lookup and .cmd shims such as npm.cmd), node's spawn elsewhere", () => {
    expect(spawnFor("win32")).toBe(crossSpawn);
    expect(spawnFor("darwin")).toBe(spawn);
    expect(spawnFor("linux")).toBe(spawn);
  });
});

describe.runIf(process.platform === "win32")("createNodeRunChild (Windows)", () => {
  it("runs a .cmd shim found through PATH/PATHEXT and propagates its exit code", async () => {
    const dir = await tmpDir();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, "anchor-shim.cmd"), "@exit /b 3\r\n");
    const env = { ...process.env, PATH: `${dir};${process.env.PATH ?? ""}` } as Record<
      string,
      string
    >;
    const r = await createNodeRunChild(new EventEmitter())("anchor-shim", ["a b", "c"], env);
    expect(exitCodeFromChild(r)).toBe(3);
  });
});

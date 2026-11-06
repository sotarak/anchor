import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CliError } from "#src/errors";
import { createNodeRunChild, exitCodeFromChild } from "#src/process/run-child";
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

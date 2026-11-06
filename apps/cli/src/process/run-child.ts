import { spawn } from "node:child_process";
import { constants } from "node:os";
import crossSpawn from "cross-spawn";
import type { RunChild } from "../context";
import { CliError } from "../errors";

export type { RunChild } from "../context";

const FORWARDED: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];

type SignalSource = Pick<NodeJS.Process, "on" | "off"> | NodeJS.EventEmitter;

/**
 * Node's spawn with shell: false cannot start `.cmd`/`.bat` shims on Windows (npm, npx, pnpm,
 * yarn), so `anchor run -- npm start` would fail there; cross-spawn resolves PATHEXT and quotes
 * the arguments for cmd.exe. Other platforms use Node's spawn directly.
 */
export function spawnFor(platform: NodeJS.Platform): typeof spawn {
  return platform === "win32" ? (crossSpawn as typeof spawn) : spawn;
}

export interface RunChildOptions {
  /**
   * Forward SIGINT to the child. Off when we run in a terminal: Ctrl-C already reaches the whole
   * foreground process group, so forwarding would deliver it twice (and many tools treat a
   * second Ctrl-C as "force quit"). SIGINT is still caught so we outlive the child.
   */
  forwardSigint: boolean;
}

/**
 * Runs the user's command with inherited stdio. While it runs, SIGTERM/SIGHUP (and SIGINT, see
 * RunChildOptions) sent to this process are forwarded to the child and do not terminate us, so
 * the child decides how to exit and we report its status.
 */
export function createNodeRunChild(
  proc: SignalSource = process,
  opts: RunChildOptions = { forwardSigint: true },
): RunChild {
  return (cmd, args, env) =>
    new Promise((resolve, reject) => {
      const child = spawnFor(process.platform)(cmd, args, { stdio: "inherit", env, shell: false });
      const forward = (signal: NodeJS.Signals) => {
        if (signal === "SIGINT" && !opts.forwardSigint) return;
        child.kill(signal);
      };
      const handlers = FORWARDED.map((sig) => [sig, () => forward(sig)] as const);
      for (const [sig, h] of handlers) proc.on(sig, h);
      const cleanup = () => {
        for (const [sig, h] of handlers) proc.off(sig, h);
      };
      child.on("error", (err: NodeJS.ErrnoException) => {
        cleanup();
        reject(err.code === "ENOENT" ? new CliError(127, `Command not found: ${cmd}`) : err);
      });
      child.on("exit", (code, signal) => {
        cleanup();
        resolve({ code, signal });
      });
    });
}

/** The child's exit code, or 128 + N when it was killed by signal N (shell convention). */
export function exitCodeFromChild(r: {
  code: number | null;
  signal: NodeJS.Signals | null;
}): number {
  if (r.code !== null) return r.code;
  const n = r.signal ? constants.signals[r.signal] : undefined;
  return 128 + (n ?? 0);
}

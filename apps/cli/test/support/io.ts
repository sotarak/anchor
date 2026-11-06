import type { CliDeps } from "#src/context";
import type { Io } from "#src/io";
import { main } from "#src/main";

export type TestIo = Io & { out(): string; err(): string };

export function createTestIo(
  opts: {
    stdin?: string;
    stdinIsTTY?: boolean;
    stdoutIsTTY?: boolean;
    stderrIsTTY?: boolean;
    env?: Record<string, string>;
    cwd?: string;
    platform?: NodeJS.Platform;
    homeDir?: string;
  } = {},
): TestIo {
  let out = "";
  let err = "";
  return {
    stdout: {
      write: (s: string) => {
        out += s;
      },
    },
    stderr: {
      write: (s: string) => {
        err += s;
      },
    },
    readStdin: async () => opts.stdin ?? "",
    stdinIsTTY: opts.stdinIsTTY ?? false,
    stdoutIsTTY: opts.stdoutIsTTY ?? false,
    stderrIsTTY: opts.stderrIsTTY ?? opts.stdinIsTTY ?? false,
    env: { ...opts.env },
    cwd: opts.cwd ?? process.cwd(),
    platform: opts.platform ?? process.platform,
    homeDir: opts.homeDir ?? "/home/test",
    out: () => out,
    err: () => err,
  };
}

/** Runs the CLI in-process exactly as the bin entry would, with injected deps. */
export function runCli(args: string[], deps: Partial<CliDeps> & { io: Io }): Promise<number> {
  return main(["node", "anchor", ...args], deps);
}

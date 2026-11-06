import type { Io } from "./io";
import { Output } from "./output";
import type { Prompts } from "./prompts";

/** Runs a helper binary with captured output. Secrets travel only via `input` (stdin). */
export type Spawner = (
  cmd: string,
  args: string[],
  opts?: { input?: string },
) => Promise<{ code: number; stdout: string; stderr: string }>;

/** Runs the user's command with inherited stdio and the given environment. */
export type RunChild = (
  cmd: string,
  args: string[],
  env: Record<string, string>,
) => Promise<{ code: number | null; signal: NodeJS.Signals | null }>;

export interface CliDeps {
  io: Io;
  prompts: Prompts;
  fetch: typeof fetch;
  spawner: Spawner;
  runChild: RunChild;
}

export interface GlobalFlags {
  json: boolean;
  quiet: boolean;
  color: boolean;
  debug: boolean;
  apiUrl?: string;
  project?: string;
  env?: string;
  path?: string;
  yes: boolean;
}

export interface CommandContext {
  deps: CliDeps;
  out: Output;
  flags: GlobalFlags;
}

export function createContext(deps: CliDeps, flags: GlobalFlags): CommandContext {
  const out = new Output(deps.io, {
    json: flags.json,
    quiet: flags.quiet,
    noColor: !flags.color,
    debug: flags.debug,
  });
  return { deps, out, flags };
}

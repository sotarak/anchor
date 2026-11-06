import type { ApiClient } from "./api/client";
import type { HttpOptions } from "./api/http";
import { type ResolvedConfig, resolveConfig } from "./config/resolve";
import type { CredentialStore } from "./credentials/types";
import { CliError, EXIT } from "./errors";
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

/** Builds an API client for one origin and (optional) token. */
export type ApiFactory = (opts: Pick<HttpOptions, "baseUrl" | "token" | "debug">) => ApiClient;

export interface CliDeps {
  io: Io;
  prompts: Prompts;
  fetch: typeof fetch;
  spawner: Spawner;
  runChild: RunChild;
  /** Overrides credential-store selection (tests); defaults to selectCredentialStore. */
  selectStore?: () => Promise<CredentialStore>;
  /** Overrides API client construction (tests); defaults to createApiClient over `fetch`. */
  createApi?: ApiFactory;
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
  config: ResolvedConfig;
}

export async function createContext(deps: CliDeps, flags: GlobalFlags): Promise<CommandContext> {
  const out = new Output(deps.io, {
    json: flags.json,
    quiet: flags.quiet,
    noColor: !flags.color,
    debug: flags.debug,
  });
  return { deps, out, flags, config: await resolveConfig(deps.io, flags) };
}

export function requireProject(ctx: Pick<CommandContext, "config">): string {
  if (!ctx.config.project) {
    throw new CliError(
      EXIT.USAGE,
      "No project selected",
      "Run 'anchor init' or pass --project <slug>",
    );
  }
  return ctx.config.project.value;
}

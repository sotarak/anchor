#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CommanderError } from "commander";
import { configureProxyFromEnv } from "./api/proxy";
import type { CliDeps } from "./context";
import { CliError, EXIT } from "./errors";
import { createNodeIo } from "./io";
import { Output } from "./output";
import { createNodeSpawner } from "./process/spawner";
import { buildProgram, type RunState } from "./program";
import { createInquirerPrompts } from "./prompts";

const UNEXPECTED = "Unexpected error (run with --debug for details)";

async function defaultDeps(partial: Partial<CliDeps>): Promise<CliDeps> {
  const unavailable = (what: string) => () => {
    throw new Error(`${what} is not available yet`);
  };
  const io = partial.io ?? createNodeIo();
  return {
    io,
    prompts: partial.prompts ?? createInquirerPrompts(),
    fetch: partial.fetch ?? (await configureProxyFromEnv(io.env)) ?? globalThis.fetch,
    spawner: partial.spawner ?? createNodeSpawner(),
    runChild: partial.runChild ?? unavailable("runChild"),
    selectStore: partial.selectStore,
    createApi: partial.createApi,
  };
}

/** Flags before `--` only: anything after it belongs to a child command. */
function hasFlag(argv: string[], flag: string): boolean {
  const end = argv.indexOf("--");
  return (end === -1 ? argv : argv.slice(0, end)).includes(flag);
}

/** Runs the CLI and returns the process exit code. Never throws. */
export async function main(argv: string[], partial: Partial<CliDeps> = {}): Promise<number> {
  const deps = await defaultDeps(partial);
  const debug = hasFlag(argv, "--debug");
  const out = new Output(deps.io, {
    json: false,
    quiet: false,
    noColor: hasFlag(argv, "--no-color"),
    debug,
  });
  const state: RunState = { exitCode: EXIT.OK };
  try {
    await buildProgram(deps, state).parseAsync(argv);
    return state.exitCode;
  } catch (e) {
    try {
      if (e instanceof CommanderError) {
        // Commander already printed help, the version or the usage error.
        if (e.code === "commander.helpDisplayed" || e.code === "commander.version") return EXIT.OK;
        return EXIT.USAGE;
      }
      if (e instanceof CliError) {
        out.error(e);
        return e.exitCode;
      }
      out.error(new CliError(EXIT.ERROR, UNEXPECTED));
      if (debug && e instanceof Error)
        deps.io.stderr.write(`${e.stack ?? `${e.name}: ${e.message}`}\n`);
    } catch {
      // Output itself failed (e.g. closed pipe); nothing more we can report.
    }
    return EXIT.ERROR;
  }
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) process.exitCode = await main(process.argv);

import { Command } from "commander";
import { type CliDeps, type CommandContext, createContext, type GlobalFlags } from "./context";
import { CLI_VERSION } from "./version";

/** Result of one CLI invocation: a handler may return a non-zero exit code (e.g. `run`). */
export type RunState = { exitCode: number };

export function buildProgram(deps: CliDeps, state: RunState = { exitCode: 0 }): Command {
  const program = new Command("anchor")
    .description("Anchor secrets manager CLI")
    .version(CLI_VERSION, "--version", "print the CLI version")
    .option("--json", "print machine-readable JSON on stdout", false)
    .option("-q, --quiet", "suppress progress messages", false)
    .option("--no-color", "disable colored output")
    .option("--debug", "print request diagnostics to stderr (never secret values)", false)
    .option("--api-url <url>", "Anchor server URL")
    .option("--project <slug>", "project slug")
    .option("--env <slug>", "environment slug")
    .option("--path <path>", "secret folder path")
    .option("-y, --yes", "skip confirmations", false)
    .enablePositionalOptions()
    // Settings below are copied to every subcommand created afterwards.
    .exitOverride()
    .configureOutput({
      writeOut: (s) => deps.io.stdout.write(s),
      writeErr: (s) => deps.io.stderr.write(s),
    })
    .configureHelp({ helpWidth: 100 })
    .showHelpAfterError("(run with --help for usage)");

  return program;
}

/** Adapts a handler to Commander: builds the context from global flags, records the exit code. */
export function actionFor(program: Command, deps: CliDeps, state: RunState) {
  return <A extends unknown[]>(
    handler: (ctx: CommandContext, ...args: A) => Promise<number | undefined>,
  ) =>
    async (...args: A) => {
      const code = await handler(await createContext(deps, program.opts<GlobalFlags>()), ...args);
      if (typeof code === "number") state.exitCode = code;
    };
}

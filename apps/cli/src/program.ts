import { Command } from "commander";
import { envsList } from "./commands/envs";
import { init } from "./commands/init";
import { login } from "./commands/login";
import { logout } from "./commands/logout";
import { projectsList } from "./commands/projects";
import { whoami } from "./commands/whoami";
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
    // Settings below are copied to every subcommand created afterwards.
    .exitOverride()
    .configureOutput({
      writeOut: (s) => deps.io.stdout.write(s),
      writeErr: (s) => deps.io.stderr.write(s),
    })
    .configureHelp({ helpWidth: 100 })
    .showHelpAfterError("(run with --help for usage)");

  const act = actionFor(program, deps, state);
  const examples = (...lines: string[]) =>
    `\nExamples:\n${lines.map((l) => `  $ ${l}`).join("\n")}\n`;

  program
    .command("login")
    .description("Log in with email and password and store a CLI session (30 days)")
    .option("--email <email>", "account email (prompted when omitted in a terminal)")
    .option("--password-stdin", "read the password from stdin (for scripts)", false)
    .addHelpText(
      "after",
      examples(
        "anchor login --api-url https://anchor.example.com",
        "printf '%s' \"$PASSWORD\" | anchor login --email me@example.com --password-stdin",
      ),
    )
    .action(act((ctx, opts: { email?: string; passwordStdin: boolean }) => login(ctx, opts)));

  program
    .command("logout")
    .description("Revoke the stored session on the server and delete it locally")
    .addHelpText("after", examples("anchor logout"))
    .action(act((ctx) => logout(ctx)));

  program
    .command("whoami")
    .description("Show the current user or service token")
    .addHelpText("after", examples("anchor whoami", "anchor whoami --json"))
    .action(act((ctx) => whoami(ctx)));

  program
    .command("init")
    .description("Link this directory to a project and default environment (.anchor.json)")
    .addHelpText("after", examples("anchor init", "anchor init --project my-app --env dev"))
    .action(act((ctx) => init(ctx)));

  const projects = program.command("projects").description("Discover projects");
  projects
    .command("list")
    .description("List the projects you can access")
    .addHelpText("after", examples("anchor projects list", "anchor projects list --json"))
    .action(act((ctx) => projectsList(ctx)));

  const envs = program.command("envs").description("Discover environments of a project");
  envs
    .command("list")
    .description("List the environments of the current project")
    .addHelpText("after", examples("anchor envs list", "anchor envs list --project my-app --json"))
    .action(act((ctx) => envsList(ctx)));

  return program;
}

/** Adapts a handler to Commander: builds the context from global flags, records the exit code. */
export function actionFor(program: Command, deps: CliDeps, state: RunState) {
  return <A extends unknown[]>(handler: (ctx: CommandContext, ...args: A) => Promise<unknown>) =>
    async (...args: A) => {
      const code = await handler(await createContext(deps, program.opts<GlobalFlags>()), ...args);
      if (typeof code === "number") state.exitCode = code;
    };
}

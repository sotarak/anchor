import { SECRET_VALUE_TYPES, type SecretValueType } from "@anchor/shared";
import { Command, Option } from "commander";
import { envsList } from "./commands/envs";
import { EXPORT_FORMATS, type ExportFormat, exportCommand } from "./commands/export";
import { foldersCreate, foldersDelete, foldersList } from "./commands/folders";
import { importsAdd, importsList, importsRemove } from "./commands/imports";
import { init } from "./commands/init";
import { login } from "./commands/login";
import { logout } from "./commands/logout";
import { projectsList } from "./commands/projects";
import { runCommand, watchIntervalMs } from "./commands/run";
import {
  secretsDelete,
  secretsGet,
  secretsHistory,
  secretsList,
  secretsRollback,
  secretsSet,
} from "./commands/secrets";
import { type SecretsImportOptions, secretsImport } from "./commands/secrets-import";
import { tokensCreate, tokensList, tokensRevoke } from "./commands/tokens";
import { whoami } from "./commands/whoami";
import { type CliDeps, type CommandContext, createContext, type GlobalFlags } from "./context";
import { IMPORT_FORMATS } from "./import/parse";
import { CLI_VERSION } from "./version";

/** Result of one CLI invocation: a handler may return a non-zero exit code (e.g. `run`). */
export type RunState = { exitCode: number };

export function buildProgram(deps: CliDeps, state: RunState = { exitCode: 0 }): Command {
  const program = new Command("anchor")
    .description("Anchor secrets manager CLI")
    .version(CLI_VERSION, "--version", "print the CLI version")
    .option("--json", "print machine-readable JSON on stdout")
    .option("-q, --quiet", "suppress progress messages")
    .option("--no-color", "disable colored output")
    .option("--debug", "print request diagnostics to stderr (never secret values)")
    .option("--api-url <url>", "Anchor server URL")
    .option("--project <slug>", "project slug")
    .option("--env <slug>", "environment slug")
    .option("--path <path>", "secret folder path")
    .option("-y, --yes", "skip confirmations")
    // Settings below are copied to every subcommand created afterwards.
    .exitOverride()
    .configureOutput({
      writeOut: (s) => deps.io.stdout.write(s),
      writeErr: (s) => deps.io.stderr.write(s),
      // Help and usage errors are plain text: deterministic, and safe to pipe.
      getOutHasColors: () => false,
      getErrHasColors: () => false,
    })
    .configureHelp({ helpWidth: 100, showGlobalOptions: true })
    .showHelpAfterError("(run with --help for usage)");

  const act = actionFor(program, deps, state);
  const examples = (...lines: string[]) =>
    `\nExamples:\n${lines.map((l) => `  $ ${l}`).join("\n")}\n`;

  program
    .command("login")
    .description("Log in (in the browser by default) and store a CLI session (30 days)")
    .option("--no-browser", "print the login URL without opening a browser")
    .option("--with-password", "log in with email and password instead of the browser")
    .option("--email <email>", "account email, implies --with-password")
    .option("--password-stdin", "read the password from stdin, implies --with-password")
    .addHelpText(
      "after",
      examples(
        "anchor login",
        "anchor login --api-url https://anchor.example.com --no-browser",
        "printf '%s' \"$PW\" | anchor login --with-password --email me@example.com --password-stdin",
      ),
    )
    .action(
      act(
        (
          ctx,
          opts: {
            email?: string;
            passwordStdin?: boolean;
            withPassword?: boolean;
            browser?: boolean;
          },
        ) => login(ctx, opts),
      ),
    );

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

  const secrets = program
    .command("secrets")
    .description("Manage secrets in the current project, environment and path");
  secrets
    .command("list")
    .description("List secrets with their type and metadata (sensitive values only with --reveal)")
    .option("--reveal", "include values")
    .addHelpText(
      "after",
      examples("anchor secrets list", "anchor secrets list --env prod --path /api --json"),
    )
    .action(
      act((ctx, opts: { reveal?: boolean }) => secretsList(ctx, { reveal: opts.reveal === true })),
    );
  secrets
    .command("get")
    .description("Print one secret (a sensitive value is masked in a terminal unless --reveal)")
    .argument("<key>", "secret key")
    .option("--reveal", "show the value in a terminal")
    .option("--expand", "expand ${KEY} references in the value (default)")
    .option("--no-expand", "print the stored value without expanding references")
    .option("--at-version <n>", "read a past version (stored value, not expanded)")
    .addHelpText(
      "after",
      examples(
        "anchor secrets get DB_URL --reveal",
        "anchor secrets get DB_URL > db-url.txt",
        "anchor secrets get DB_URL --at-version 2 --reveal",
      ),
    )
    .action(
      act((ctx, key: string, opts: { reveal?: boolean; expand?: boolean; atVersion?: string }) =>
        secretsGet(ctx, key, {
          reveal: opts.reveal === true,
          expand: opts.expand !== false,
          atVersion: opts.atVersion,
        }),
      ),
    );
  secrets
    .command("history")
    .description("List the versions of a secret (no values)")
    .argument("<key>", "secret key")
    .addHelpText(
      "after",
      examples("anchor secrets history DB_URL", "anchor secrets history DB_URL --json"),
    )
    .action(act((ctx, key: string) => secretsHistory(ctx, key)));
  secrets
    .command("rollback")
    .description(
      "Restore a past version as a new version (asks for confirmation; --yes in scripts)",
    )
    .argument("<key>", "secret key")
    .requiredOption("--to <n>", "the version to restore")
    .addHelpText(
      "after",
      examples(
        "anchor secrets rollback DB_URL --to 2",
        "anchor secrets rollback DB_URL --to 2 --yes",
      ),
    )
    .action(act((ctx, key: string, opts: { to: string }) => secretsRollback(ctx, key, opts)));
  secrets
    .command("set")
    .description("Create or update a secret; the value comes from stdin, --from-file or a prompt")
    .argument("<key>", "secret key")
    .option("--from-file <path>", "read the value from a file (exact bytes)")
    .option("--comment <text>", "comment stored with the secret")
    .addOption(
      new Option(
        "--type <type>",
        "value type, checked before sending (default: keep the current)",
      ).choices(SECRET_VALUE_TYPES),
    )
    .option("--sensitive", "mask the value unless revealed (default for new secrets)")
    .option("--no-sensitive", "plain config: shown without --reveal")
    .addHelpText(
      "after",
      examples(
        "anchor secrets set DB_URL            # prompts for the value",
        "printf '%s' \"$DB_URL\" | anchor secrets set DB_URL",
        "anchor secrets set TLS_KEY --from-file key.pem --type pem",
        "printf 8080 | anchor secrets set APP_PORT --type number --no-sensitive",
      ),
    )
    .action(
      act(
        (
          ctx,
          key: string,
          opts: {
            fromFile?: string;
            comment?: string;
            type?: SecretValueType;
            sensitive?: boolean;
          },
        ) => secretsSet(ctx, key, opts),
      ),
    );
  secrets
    .command("import")
    .description(
      "Import a dotenv, JSON or YAML file; nested keys become UPPER_SNAKE and types are inferred (not to be confused with 'imports', which links folders)",
    )
    .option("--from-file <path>", "file to import (otherwise piped stdin with --format)")
    .addOption(
      new Option("--format <format>", "file format (default: from the extension)").choices(
        IMPORT_FORMATS,
      ),
    )
    .option("--overwrite", "write a new version of keys that already exist (default: skip them)")
    .option(
      "--non-sensitive <glob>",
      "keys matching this glob (* and ?) are plain config; repeatable",
      (glob: string, prev: string[] | undefined) => [...(prev ?? []), glob],
    )
    .option("--comment <text>", "comment stored with every imported secret")
    .option("--dry-run", "show what would be written and stop")
    .addHelpText(
      "after",
      examples(
        "anchor secrets import --from-file application.config.yaml --env prod --path /shared --non-sensitive 'CONFIGS_CONTEXT_*' --non-sensitive 'CONFIGS_AGENT_*' --dry-run",
        "anchor secrets import --from-file apps/service-agent/.env --env prod --path /service-agent",
      ),
    )
    .action(
      act(
        (
          ctx,
          opts: Omit<SecretsImportOptions, "overwrite" | "dryRun" | "nonSensitive"> & {
            overwrite?: boolean;
            dryRun?: boolean;
            nonSensitive?: string[];
          },
        ) =>
          secretsImport(ctx, {
            ...opts,
            overwrite: opts.overwrite === true,
            dryRun: opts.dryRun === true,
            nonSensitive: opts.nonSensitive ?? [],
          }),
      ),
    );
  secrets
    .command("delete")
    .description("Delete a secret (asks for confirmation; --yes in scripts)")
    .argument("<key>", "secret key")
    .addHelpText(
      "after",
      examples("anchor secrets delete OLD_KEY", "anchor secrets delete OLD_KEY --yes"),
    )
    .action(act((ctx, key: string) => secretsDelete(ctx, key)));

  const folders = program
    .command("folders")
    .description("Manage folders in the current project and environment");
  folders
    .command("list")
    .description("List the subfolders of --path (default /)")
    .addHelpText("after", examples("anchor folders list", "anchor folders list --path /api --json"))
    .action(act((ctx) => foldersList(ctx)));
  folders
    .command("create")
    .description("Create a folder and its parents (no-op if it exists)")
    .argument("<path>", "folder path from the root, e.g. /api/v2")
    .addHelpText(
      "after",
      examples("anchor folders create /api", "anchor folders create /api/v2 --env prod"),
    )
    .action(act((ctx, path: string) => foldersCreate(ctx, path)));
  folders
    .command("delete")
    .description("Delete an empty folder; --force also deletes its secrets and subfolders")
    .argument("<path>", "folder path from the root")
    .option("--force", "delete the secrets and subfolders inside it too")
    .addHelpText(
      "after",
      examples("anchor folders delete /old", "anchor folders delete /old --force --yes"),
    )
    .action(
      act((ctx, path: string, opts: { force?: boolean }) =>
        foldersDelete(ctx, path, { force: opts.force === true }),
      ),
    );

  const imports = program
    .command("imports")
    .description(
      "Make a folder show the secrets of another folder (not to be confused with 'secrets import', which loads a file)",
    );
  imports
    .command("list")
    .description("List the folders --path imports, in the order they apply")
    .addHelpText(
      "after",
      examples("anchor imports list", "anchor imports list --env prod --path /api --json"),
    )
    .action(act((ctx) => importsList(ctx)));
  imports
    .command("add")
    .description("Import <env>:<path> into --path (no-op if it already does)")
    .argument("<source>", "folder to import, e.g. shared:/ or prod:/shared")
    .addHelpText(
      "after",
      examples(
        "anchor imports add shared:/ --env prod --path /api",
        "anchor imports add prod:/shared --env prod --path /worker",
      ),
    )
    .action(act((ctx, source: string) => importsAdd(ctx, source)));
  imports
    .command("remove")
    .description("Stop importing <env>:<path> into --path")
    .argument("<source>", "imported folder, e.g. shared:/")
    .addHelpText("after", examples("anchor imports remove shared:/ --env prod --path /api --yes"))
    .action(act((ctx, source: string) => importsRemove(ctx, source)));

  program
    .command("run")
    .description("Run a command with the environment's secrets injected as environment variables")
    .argument("[command...]", "the command to run, after --")
    .option("--no-override", "keep existing environment variables instead of Anchor values")
    .option("--expand", "expand ${KEY} references in values (default)")
    .option("--no-expand", "inject stored values without expanding references")
    .option("--watch", "restart the command when its secrets change")
    .option("--watch-interval <seconds>", "how often to check, in seconds (default 30, minimum 5)")
    .usage("[options] -- <command> [args...]")
    .addHelpText(
      "after",
      examples(
        "anchor run -- npm start",
        "anchor run --env prod --path /api -- node server.js",
        "anchor run --watch -- npm run dev",
      ),
    )
    .action(
      act(
        (
          ctx,
          command: string[],
          opts: { override: boolean; expand?: boolean; watch?: boolean; watchInterval?: string },
        ) => {
          const intervalMs = watchIntervalMs(opts.watch === true, opts.watchInterval);
          return runCommand(ctx, command, {
            override: opts.override,
            expand: opts.expand !== false,
            watch: intervalMs === undefined ? undefined : { intervalMs },
          });
        },
      ),
    );

  program
    .command("export")
    .description("Write the environment's secrets as dotenv, JSON or YAML (file mode 0600)")
    .addOption(
      new Option("--format <format>", "output format").choices(EXPORT_FORMATS).default("dotenv"),
    )
    .option("--output <file>", "write to a file instead of stdout")
    .option("--expand", "expand ${KEY} references in values (default)")
    .option("--no-expand", "write stored values without expanding references")
    .addHelpText(
      "after",
      examples(
        "anchor export --output .env.local",
        "anchor export --format json --env prod > secrets.json",
      ),
    )
    .action(
      act((ctx, opts: { format: ExportFormat; output?: string; expand?: boolean }) =>
        exportCommand(ctx, {
          format: opts.format,
          output: opts.output,
          expand: opts.expand !== false,
        }),
      ),
    );

  const tokens = program.command("tokens").description("Manage service tokens for CI and servers");
  tokens
    .command("create")
    .description("Create a service token (printed once on stdout)")
    .requiredOption("--name <name>", "token name")
    .option(
      "--scope <env[:path]>",
      "environment and optional path prefix; repeatable (default: current env, /)",
      (value: string, previous: string[] = []) => [...previous, value],
    )
    .addOption(
      new Option("--permission <permission>", "access level")
        .choices(["read", "read-write"])
        .default("read"),
    )
    .option("--expires-in <days>", "lifetime in days (1-365) or never", "90")
    .addHelpText(
      "after",
      examples(
        "anchor tokens create --name ci --scope prod --permission read",
        "anchor tokens create --name deploy --scope prod:/api --expires-in 30 --json",
        "anchor tokens create --name home-server --scope prod --expires-in never",
      ),
    )
    .action(
      act(
        (
          ctx,
          opts: {
            name: string;
            scope?: string[];
            permission: "read" | "read-write";
            expiresIn: string;
          },
        ) => tokensCreate(ctx, opts),
      ),
    );
  tokens
    .command("list")
    .description("List the project's service tokens")
    .addHelpText("after", examples("anchor tokens list", "anchor tokens list --json"))
    .action(act((ctx) => tokensList(ctx)));
  tokens
    .command("revoke")
    .description("Revoke a service token (asks for confirmation; --yes in scripts)")
    .argument("<id>", "token id (see 'anchor tokens list')")
    .addHelpText(
      "after",
      examples("anchor tokens revoke tok_123", "anchor tokens revoke tok_123 --yes"),
    )
    .action(act((ctx, id: string) => tokensRevoke(ctx, id)));

  return program;
}

/** Adapts a handler to Commander: builds the context from global flags, records the exit code. */
export function actionFor(program: Command, deps: CliDeps, state: RunState) {
  return <A extends unknown[]>(handler: (ctx: CommandContext, ...args: A) => Promise<unknown>) =>
    async (...args: A) => {
      const o = program.opts<Partial<GlobalFlags>>();
      const flags: GlobalFlags = {
        ...o,
        json: o.json === true,
        quiet: o.quiet === true,
        color: o.color !== false,
        debug: o.debug === true,
        yes: o.yes === true,
      };
      const code = await handler(await createContext(deps, flags), ...args);
      if (typeof code === "number") state.exitCode = code;
    };
}

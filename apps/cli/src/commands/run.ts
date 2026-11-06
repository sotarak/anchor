import type { SecretDto } from "@anchor/shared";
import { positionals } from "../argv";
import { authedApi } from "../auth";
import { type CommandContext, requireProject } from "../context";
import { CliError, EXIT, withExpandHint } from "../errors";
import { exitCodeFromChild } from "../process/run-child";

/** Parent env plus secrets. By default Anchor values win; with override=false existing vars win. */
export function buildChildEnv(
  parent: Record<string, string | undefined>,
  secrets: SecretDto[],
  override: boolean,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(parent)) if (v !== undefined) env[k] = v;
  for (const s of secrets) {
    if (s.value === undefined) continue;
    if (override || !(s.key in env)) env[s.key] = s.value;
  }
  return env;
}

const RUN_USAGE = "Usage: anchor run [options] -- <command> [args...]";

/**
 * `anchor run` takes its command only after `--`. Without it, flags meant for the child
 * (`--env prod`) would silently be parsed as Anchor's own, so this exits 2 instead.
 */
export function assertRunSeparator(argv: string[]): void {
  const [first, ...rest] = positionals(argv);
  if (first?.value !== "run" || first.afterDashDash) return;
  if (rest.some((p) => !p.afterDashDash)) {
    throw new CliError(EXIT.USAGE, "Put the command after --", RUN_USAGE);
  }
}

/**
 * Fetches secrets, then runs the command with them in its environment. Any fetch failure is
 * thrown before the child starts (fail closed). Returns the child's exit code.
 */
export async function runCommand(
  ctx: CommandContext,
  argv: string[],
  opts: { override: boolean; expand: boolean },
): Promise<number> {
  const [cmd, ...args] = argv;
  if (!cmd) {
    throw new CliError(EXIT.USAGE, "Missing command", RUN_USAGE);
  }
  const project = requireProject(ctx);
  const { api } = await authedApi(ctx);
  const secrets = await withExpandHint(
    opts.expand,
    api.listSecrets(project, ctx.config.env.value, {
      path: ctx.config.path.value,
      reveal: true,
      expand: opts.expand,
      includeImports: true,
    }),
  );
  const env = buildChildEnv(ctx.deps.io.env, secrets, opts.override);
  ctx.out.debug(`injecting ${secrets.length} secrets into ${cmd}`);
  return exitCodeFromChild(await ctx.deps.runChild(cmd, args, env));
}

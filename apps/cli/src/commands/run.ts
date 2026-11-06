import type { SecretDto } from "@anchor/shared";
import { authedApi } from "../auth";
import { type CommandContext, requireProject } from "../context";
import { CliError, EXIT } from "../errors";
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

/**
 * Fetches secrets, then runs the command with them in its environment. Any fetch failure is
 * thrown before the child starts (fail closed). Returns the child's exit code.
 */
export async function runCommand(
  ctx: CommandContext,
  argv: string[],
  opts: { override: boolean },
): Promise<number> {
  const [cmd, ...args] = argv;
  if (!cmd) {
    throw new CliError(
      EXIT.USAGE,
      "Missing command",
      "Usage: anchor run [options] -- <command> [args...]",
    );
  }
  const project = requireProject(ctx);
  const { api } = await authedApi(ctx);
  const secrets = await api.listSecrets(project, ctx.config.env.value, {
    path: ctx.config.path.value,
    reveal: true,
  });
  const env = buildChildEnv(ctx.deps.io.env, secrets, opts.override);
  ctx.out.debug(`injecting ${secrets.length} secrets into ${cmd}`);
  return exitCodeFromChild(await ctx.deps.runChild(cmd, args, env));
}

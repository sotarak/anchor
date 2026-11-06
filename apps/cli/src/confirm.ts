import type { CommandContext } from "./context";
import { CliError, EXIT } from "./errors";
import { isInteractive } from "./interactive";

/** Destructive steps need --yes, or an explicit "yes" at a terminal prompt (default: no). */
export async function confirmDestructive(ctx: CommandContext, message: string): Promise<void> {
  if (ctx.flags.yes) return;
  if (!isInteractive(ctx)) {
    throw new CliError(EXIT.USAGE, "Refusing to continue without --yes in non-interactive mode");
  }
  if (!(await ctx.deps.prompts.confirm({ message, default: false }))) {
    throw new CliError(EXIT.ERROR, "Aborted");
  }
}

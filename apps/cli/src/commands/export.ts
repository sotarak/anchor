import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { authedApi } from "../auth";
import { confirmDestructive } from "../confirm";
import { type CommandContext, requireProject } from "../context";
import { CliError, EXIT, withExpandHint } from "../errors";
import { isGitIgnored, writeSecretFile } from "../files";
import { type Entry, formatDotenv, formatJson, formatYaml } from "../format/env-file";

export const EXPORT_FORMATS = ["dotenv", "json", "yaml"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

const FORMATTERS: Record<ExportFormat, (entries: Entry[]) => string> = {
  dotenv: formatDotenv,
  json: formatJson,
  yaml: formatYaml,
};

export async function exportCommand(
  ctx: CommandContext,
  opts: { format: ExportFormat; output?: string; expand: boolean },
): Promise<void> {
  const { io } = ctx.deps;
  if (!opts.output) {
    if (ctx.flags.json) throw new CliError(EXIT.USAGE, "Use --format json instead of --json");
    if (io.stdoutIsTTY) {
      throw new CliError(
        EXIT.USAGE,
        "Refusing to print secrets to a terminal",
        "Use --output <file> or pipe the output",
      );
    }
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
  const entries: Entry[] = secrets
    .filter((s) => s.value !== undefined)
    .map((s): Entry => [s.key, s.value as string])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  // Format first: a value that cannot be represented fails before any file is touched.
  const content = FORMATTERS[opts.format](entries);

  if (!opts.output) {
    ctx.out.raw(content);
    return;
  }
  const path = resolve(io.cwd, opts.output);
  const exists = await access(path).then(
    () => true,
    () => false,
  );
  if (exists) await confirmDestructive(ctx, `Overwrite ${opts.output}?`);
  await writeSecretFile(path, content);
  if ((await isGitIgnored(path, ctx.deps.spawner)) === false) {
    ctx.out.warn(`${opts.output} is not gitignored; add it to .gitignore`);
  }
  ctx.out.data(
    { path, count: entries.length, format: opts.format },
    () => `Wrote ${entries.length} secrets to ${opts.output}`,
  );
}

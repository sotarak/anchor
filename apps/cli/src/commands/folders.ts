import { normalizeSecretPath } from "@anchor/shared";
import { authedApi } from "../auth";
import { confirmDestructive } from "../confirm";
import { type CommandContext, requireProject } from "../context";
import { CliError, EXIT } from "../errors";

const NOT_EMPTY_HINT = "Re-run with --force to delete its secrets and subfolders.";

/** A folder argument is absolute from the root ("api/" means "/api"); the root is not one. */
function folderArg(raw: string): string {
  let path: string;
  try {
    path = normalizeSecretPath(raw);
  } catch {
    throw new CliError(
      EXIT.USAGE,
      `Invalid folder path '${raw}'`,
      "Use segments of letters, digits, '_' or '-', e.g. /api/v2",
    );
  }
  if (path === "/") throw new CliError(EXIT.USAGE, "The root folder always exists");
  return path;
}

export async function foldersList(ctx: CommandContext): Promise<void> {
  const project = requireProject(ctx);
  const env = ctx.config.env.value;
  const path = ctx.config.path.value;
  const { api } = await authedApi(ctx);
  const folders = await api.listFolders(project, env, { path });
  if (folders.length === 0 && !ctx.flags.json) {
    ctx.out.info(`No folders in ${env}:${path}`);
    return;
  }
  ctx.out.data(folders, () => folders.map((f) => f.name).join("\n"));
}

export async function foldersCreate(ctx: CommandContext, raw: string): Promise<void> {
  const path = folderArg(raw);
  const project = requireProject(ctx);
  const env = ctx.config.env.value;
  const { api } = await authedApi(ctx);
  const { folder, created } = await api.createFolder(project, env, { path });
  ctx.out.data({ folder, created }, () =>
    created ? `Created folder ${path} in ${env}` : `Folder ${path} already exists in ${env}`,
  );
}

export async function foldersDelete(
  ctx: CommandContext,
  raw: string,
  opts: { force: boolean },
): Promise<void> {
  const path = folderArg(raw);
  const project = requireProject(ctx);
  const env = ctx.config.env.value;
  await confirmDestructive(
    ctx,
    opts.force
      ? `Delete folder ${path} in ${env} and every secret and subfolder in it?`
      : `Delete empty folder ${path} in ${env}?`,
  );
  const { api } = await authedApi(ctx);
  try {
    await api.deleteFolder(project, env, { path, force: opts.force });
  } catch (e) {
    if (!opts.force && e instanceof CliError && e.apiCode === "conflict") {
      throw new CliError(e.exitCode, e.message, NOT_EMPTY_HINT, e.apiCode);
    }
    throw e;
  }
  ctx.out.data(
    { deleted: { path, environment: env, force: opts.force } },
    () => `Deleted folder ${path} from ${env}`,
  );
}

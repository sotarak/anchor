import { type FolderImportDto, normalizeSecretPath, slugSchema } from "@anchor/shared";
import { authedApi } from "../auth";
import { confirmDestructive } from "../confirm";
import { type CommandContext, requireProject } from "../context";
import { CliError, EXIT } from "../errors";

export type ImportSource = { environment: string; path: string };

const where = (s: ImportSource) => `${s.environment}:${s.path}`;

/**
 * `<env>:<path>`, the form references use. `shared` and `shared:` mean `shared:/`; a relative
 * path is from the root (`shared:db/` is `shared:/db`).
 */
export function parseImportSource(raw: string): ImportSource {
  const colon = raw.indexOf(":");
  const environment = colon === -1 ? raw : raw.slice(0, colon);
  const rest = colon === -1 ? "" : raw.slice(colon + 1);
  try {
    if (!slugSchema.safeParse(environment).success) throw new Error("bad environment");
    return { environment, path: rest === "" ? "/" : normalizeSecretPath(rest) };
  } catch {
    throw new CliError(
      EXIT.USAGE,
      `Invalid import source '${raw}'`,
      "Use <env>:<path>, e.g. shared:/ or shared:/db",
    );
  }
}

/** The folder the command acts on: --env and --path, defaults from .anchor.json. */
function target(ctx: CommandContext) {
  return {
    project: requireProject(ctx),
    env: ctx.config.env.value,
    path: ctx.config.path.value,
  };
}

const find = (imports: FolderImportDto[], s: ImportSource) =>
  imports.find((i) => i.source.environment === s.environment && i.source.path === s.path);

export async function importsList(ctx: CommandContext): Promise<void> {
  const { project, env, path } = target(ctx);
  const { api } = await authedApi(ctx);
  const imports = await api.listImports(project, env, { path });
  if (imports.length === 0 && !ctx.flags.json) {
    ctx.out.info(`No imports in ${env}:${path}`);
    return;
  }
  ctx.out.data(imports, () => imports.map((i, n) => `${n + 1}  ${where(i.source)}`).join("\n"));
}

export async function importsAdd(ctx: CommandContext, raw: string): Promise<void> {
  const source = parseImportSource(raw);
  const { project, env, path } = target(ctx);
  const { api } = await authedApi(ctx);
  let existing = find(await api.listImports(project, env, { path }), source);
  let created = false;
  if (!existing) {
    try {
      existing = await api.createImport(project, env, { path, source });
      created = true;
    } catch (e) {
      // Another writer added the same import between the list and the POST.
      if (!(e instanceof CliError && e.apiCode === "conflict")) throw e;
      existing = find(await api.listImports(project, env, { path }), source);
      if (!existing) throw e;
    }
  }
  const result = { import: existing, created };
  ctx.out.data(result, () =>
    created
      ? `Imported ${where(source)} into ${env}:${path}`
      : `Already imports ${where(source)} into ${env}:${path}`,
  );
}

export async function importsRemove(ctx: CommandContext, raw: string): Promise<void> {
  const source = parseImportSource(raw);
  const { project, env, path } = target(ctx);
  await confirmDestructive(ctx, `Stop importing ${where(source)} into ${env}:${path}?`);
  const { api } = await authedApi(ctx);
  const imports = await api.listImports(project, env, { path });
  const found = find(imports, source);
  if (!found) {
    throw new CliError(
      EXIT.NOT_FOUND,
      `${env}:${path} does not import ${where(source)}`,
      imports.length === 0
        ? "It has no imports"
        : `Its imports: ${imports.map((i) => where(i.source)).join(", ")}`,
    );
  }
  await api.deleteImport(project, env, found.id);
  ctx.out.data({ removed: found }, () => `Stopped importing ${where(source)} into ${env}:${path}`);
}

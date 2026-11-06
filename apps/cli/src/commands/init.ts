import { access } from "node:fs/promises";
import { join } from "node:path";
import { authedApi } from "../auth";
import { PROJECT_FILE, type ProjectFile, writeProjectFile } from "../config/project-file";
import { confirmDestructive } from "../confirm";
import type { CommandContext } from "../context";
import { CliError, EXIT } from "../errors";
import { isInteractive } from "../interactive";

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** Links the current directory to a project: writes `.anchor.json` (identifiers only). */
export async function init(ctx: CommandContext): Promise<void> {
  const { prompts, io } = ctx.deps;
  const interactive = isInteractive(ctx);
  if (!ctx.flags.project && !interactive) {
    throw new CliError(EXIT.USAGE, "Pass --project in non-interactive mode");
  }
  const { api } = await authedApi(ctx);

  let project = ctx.flags.project;
  if (!project) {
    const projects = await api.listProjects();
    if (projects.length === 0) throw new CliError(EXIT.ERROR, "No projects available");
    project = await prompts.select({
      message: "Project",
      choices: projects.map((p) => ({ name: `${p.name} (${p.slug})`, value: p.slug })),
    });
  }
  try {
    await api.getProject(project);
  } catch (e) {
    if (e instanceof CliError && e.exitCode === EXIT.NOT_FOUND) {
      throw new CliError(EXIT.NOT_FOUND, `Project ${project} not found`);
    }
    throw e;
  }

  let defaultEnv = ctx.flags.env;
  if (!defaultEnv) {
    const envs = await api.listEnvironments(project);
    if (envs.length === 0) throw new CliError(EXIT.ERROR, `Project ${project} has no environments`);
    defaultEnv = interactive
      ? await prompts.select({
          message: "Default environment",
          choices: envs.map((e) => ({ name: `${e.name} (${e.slug})`, value: e.slug })),
        })
      : (envs.find((e) => e.slug === "dev") ?? envs[0])?.slug;
  }

  if (await exists(join(io.cwd, PROJECT_FILE))) {
    await confirmDestructive(ctx, `Overwrite ${PROJECT_FILE}?`);
  }
  const pf: ProjectFile = { version: 1, project, defaultEnv };
  if (ctx.config.apiUrl?.source === "flag") pf.apiUrl = ctx.config.apiUrl.value;
  const projectFile = await writeProjectFile(io.cwd, pf);
  ctx.out.data(
    { projectFile, project, defaultEnv },
    () => `Linked ${io.cwd} to ${project} (default env ${defaultEnv})`,
  );
}

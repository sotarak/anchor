import { normalizeSecretPath } from "@anchor/shared";
import type { GlobalFlags } from "../context";
import { CliError, EXIT } from "../errors";
import type { Io } from "../io";
import { normalizeApiUrl } from "./api-url";
import { findProjectFile, type ProjectFile, readProjectFile } from "./project-file";
import { readUserConfig } from "./user-config";

export type Source = "flag" | "env" | "project" | "user" | "default";
export type Sourced = { value: string; source: Source };

export interface ResolvedConfig {
  apiUrl: Sourced | null;
  project: Sourced | null;
  env: Sourced;
  path: Sourced;
  projectFilePath: string | null;
  userApiUrl: string | null;
}

function first(...candidates: [string | undefined, Source][]): Sourced | null {
  for (const [value, source] of candidates) {
    if (value !== undefined && value !== "") return { value, source };
  }
  return null;
}

function normalizePath(input: string): string {
  try {
    return normalizeSecretPath(input);
  } catch {
    throw new CliError(EXIT.USAGE, `Invalid path: ${input}`);
  }
}

/** Precedence: flags > ANCHOR_* env > .anchor.json (nearest) > user config > defaults. */
export async function resolveConfig(io: Io, flags: GlobalFlags): Promise<ResolvedConfig> {
  const projectFilePath = await findProjectFile(io.cwd);
  const pf: Partial<ProjectFile> = projectFilePath ? await readProjectFile(projectFilePath) : {};
  const user = await readUserConfig(io);
  const userApiUrl = user.apiUrl ? normalizeApiUrl(user.apiUrl) : null;

  const apiUrl = first(
    [flags.apiUrl, "flag"],
    [io.env.ANCHOR_API_URL, "env"],
    [pf.apiUrl, "project"],
    [userApiUrl ?? undefined, "user"],
  );
  const env = first(
    [flags.env, "flag"],
    [io.env.ANCHOR_ENV, "env"],
    [pf.defaultEnv, "project"],
  ) ?? { value: "dev", source: "default" as const };
  const path = first([flags.path, "flag"], [io.env.ANCHOR_PATH, "env"], [pf.path, "project"]) ?? {
    value: "/",
    source: "default" as const,
  };

  return {
    apiUrl: apiUrl && { value: normalizeApiUrl(apiUrl.value), source: apiUrl.source },
    project: first(
      [flags.project, "flag"],
      [io.env.ANCHOR_PROJECT, "env"],
      [pf.project, "project"],
    ),
    env,
    path: { value: normalizePath(path.value), source: path.source },
    projectFilePath,
    userApiUrl,
  };
}

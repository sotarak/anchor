import { access, chmod, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { secretPathSchema, slugSchema } from "@anchor/shared";
import { z } from "zod";
import { CliError, EXIT } from "../errors";

export const PROJECT_FILE = ".anchor.json";

export const projectFileSchema = z.strictObject({
  version: z.literal(1),
  project: slugSchema,
  defaultEnv: slugSchema.optional(),
  path: secretPathSchema.optional(),
  apiUrl: z.string().optional(),
});

export type ProjectFile = z.infer<typeof projectFileSchema>;

/** Walks up from `cwd` to the filesystem root; returns the first `.anchor.json`. */
export async function findProjectFile(cwd: string): Promise<string | null> {
  let dir = cwd;
  for (;;) {
    const candidate = join(dir, PROJECT_FILE);
    try {
      await access(candidate);
      return candidate;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
}

function containsToken(value: unknown): boolean {
  if (typeof value === "string") return value.startsWith("anc_");
  if (Array.isArray(value)) return value.some(containsToken);
  if (value && typeof value === "object") return Object.values(value).some(containsToken);
  return false;
}

/** Reads and validates a project file. It holds identifiers only: never tokens, never values. */
export async function readProjectFile(path: string): Promise<ProjectFile> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new CliError(EXIT.ERROR, `${path} is invalid: not valid JSON`);
  }
  if (containsToken(raw)) {
    throw new CliError(
      EXIT.ERROR,
      `${path} contains a token. Tokens must never be stored in .anchor.json`,
      "Remove it and rotate the token",
    );
  }
  const parsed = projectFileSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = parsed.error.issues.flatMap((issue) =>
      issue.code === "unrecognized_keys" ? issue.keys : [issue.path.join(".") || "(root)"],
    );
    throw new CliError(EXIT.ERROR, `${path} is invalid: ${[...new Set(fields)].join(", ")}`);
  }
  return parsed.data;
}

export async function writeProjectFile(dir: string, pf: ProjectFile): Promise<string> {
  const path = join(dir, PROJECT_FILE);
  await writeFile(path, `${JSON.stringify(pf, null, 2)}\n`, { mode: 0o644 });
  await chmod(path, 0o644);
  return path;
}

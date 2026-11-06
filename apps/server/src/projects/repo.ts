import type { EnvironmentDto, ProjectDto } from "@anchor/shared";
import { createWrappedKek, unwrapKek } from "../crypto/keyring";
import { isUniqueViolation, toBytes } from "../lib/d1";
import { ApiError } from "../lib/errors";
import { newId } from "../lib/random";

export type ProjectRow = {
  id: string;
  slug: string;
  name: string;
  current_key_version: number;
  created_at: number;
};

export type EnvironmentRow = {
  id: string;
  project_id: string;
  slug: string;
  name: string;
  position: number;
};

export const DEFAULT_ENVIRONMENTS = [
  { slug: "dev", name: "Development" },
  { slug: "staging", name: "Staging" },
  { slug: "prod", name: "Production" },
] as const;

const PROJECT_COLUMNS = "id, slug, name, current_key_version, created_at";

export async function createProject(
  db: D1Database,
  rootKey: CryptoKey,
  input: { name: string; slug: string },
  now: number,
): Promise<ProjectRow> {
  const id = newId();
  const kek = await createWrappedKek(rootKey, id, 1);
  const statements = [
    db
      .prepare(
        "INSERT INTO projects (id, slug, name, current_key_version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
      )
      .bind(id, input.slug, input.name, now, now),
    db
      .prepare(
        "INSERT INTO project_keys (project_id, version, root_key_id, iv, wrapped_key, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(id, kek.version, kek.rootKeyId, kek.iv, kek.wrappedKey, now),
    ...DEFAULT_ENVIRONMENTS.map((e, position) =>
      db
        .prepare(
          "INSERT INTO environments (id, project_id, slug, name, position, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(newId(), id, e.slug, e.name, position, now),
    ),
  ];
  try {
    await db.batch(statements);
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, "conflict", "Project slug already exists");
    throw err;
  }
  return { id, slug: input.slug, name: input.name, current_key_version: 1, created_at: now };
}

export async function listProjects(db: D1Database): Promise<ProjectRow[]> {
  const { results } = await db
    .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects ORDER BY name, slug`)
    .all<ProjectRow>();
  return results;
}

export async function getProjectBySlug(db: D1Database, slug: string): Promise<ProjectRow> {
  const row = await db
    .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE slug = ?`)
    .bind(slug)
    .first<ProjectRow>();
  if (!row) throw new ApiError(404, "not_found", "Project not found");
  return row;
}

export async function updateProjectName(
  db: D1Database,
  id: string,
  name: string,
  now: number,
): Promise<void> {
  await db
    .prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?")
    .bind(name, now, id)
    .run();
}

export async function deleteProject(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM projects WHERE id = ?").bind(id).run();
}

export async function getProjectKek(
  db: D1Database,
  rootKey: CryptoKey,
  project: ProjectRow,
  version: number = project.current_key_version,
): Promise<CryptoKey> {
  const row = await db
    .prepare(
      "SELECT root_key_id, iv, wrapped_key FROM project_keys WHERE project_id = ? AND version = ?",
    )
    .bind(project.id, version)
    .first<{ root_key_id: string; iv: unknown; wrapped_key: unknown }>();
  if (!row) throw new Error("project key not found");
  return unwrapKek(rootKey, {
    projectId: project.id,
    version,
    rootKeyId: row.root_key_id,
    iv: toBytes(row.iv),
    wrappedKey: toBytes(row.wrapped_key),
  });
}

export function toProjectDto(row: ProjectRow): ProjectDto {
  return { id: row.id, slug: row.slug, name: row.name, createdAt: row.created_at };
}

export function toEnvironmentDto(row: EnvironmentRow): EnvironmentDto {
  return { id: row.id, slug: row.slug, name: row.name, position: row.position };
}

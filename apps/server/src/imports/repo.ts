import type { FolderImportDto } from "@anchor/shared";
import { isUniqueViolation } from "../lib/d1";
import { ApiError } from "../lib/errors";
import { newId } from "../lib/random";

export type ImportRow = {
  id: string;
  environment_id: string;
  path: string;
  source_environment_id: string;
  source_environment_slug: string;
  source_path: string;
  position: number;
};

const SELECT = `SELECT i.id, i.environment_id, i.path, i.source_environment_id,
    e.slug AS source_environment_slug, i.source_path, i.position
  FROM folder_imports i JOIN environments e ON e.id = i.source_environment_id`;

export function toImportDto(r: ImportRow): FolderImportDto {
  return {
    id: r.id,
    path: r.path,
    source: { environment: r.source_environment_slug, path: r.source_path },
    position: r.position,
  };
}

/** Imports of the folder at (environmentId, path), lowest position first. */
export async function listImports(
  db: D1Database,
  environmentId: string,
  path: string,
): Promise<ImportRow[]> {
  const { results } = await db
    .prepare(`${SELECT} WHERE i.environment_id = ? AND i.path = ? ORDER BY i.position, i.id`)
    .bind(environmentId, path)
    .all<ImportRow>();
  return results;
}

export async function getImport(
  db: D1Database,
  environmentId: string,
  id: string,
): Promise<ImportRow> {
  const row = await db
    .prepare(`${SELECT} WHERE i.id = ? AND i.environment_id = ?`)
    .bind(id, environmentId)
    .first<ImportRow>();
  if (!row) throw new ApiError(404, "not_found", "Import not found");
  return row;
}

/** Appends an import after the folder's existing ones. */
export async function createImport(
  db: D1Database,
  input: { environmentId: string; path: string; sourceEnvironmentId: string; sourcePath: string },
  now: number,
): Promise<ImportRow> {
  if (input.sourceEnvironmentId === input.environmentId && input.sourcePath === input.path) {
    throw new ApiError(400, "bad_request", "A folder cannot import itself");
  }
  const id = newId();
  try {
    await db
      .prepare(
        `INSERT INTO folder_imports
           (id, environment_id, path, source_environment_id, source_path, position, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, COALESCE(MAX(position), 0) + 1, ?6
         FROM folder_imports WHERE environment_id = ?2 AND path = ?3`,
      )
      .bind(id, input.environmentId, input.path, input.sourceEnvironmentId, input.sourcePath, now)
      .run();
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, "conflict", "This import already exists");
    throw err;
  }
  return getImport(db, input.environmentId, id);
}

export async function deleteImport(
  db: D1Database,
  environmentId: string,
  id: string,
): Promise<void> {
  const result = await db
    .prepare("DELETE FROM folder_imports WHERE id = ? AND environment_id = ?")
    .bind(id, environmentId)
    .run();
  if (result.meta.changes === 0) throw new ApiError(404, "not_found", "Import not found");
}

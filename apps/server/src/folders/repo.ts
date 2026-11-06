import type { FolderDto } from "@anchor/shared";
import { newId } from "../lib/random";
import { ancestors, childSegment, likePrefix } from "../secrets/paths";

/**
 * SQL for "column is `path` or inside it". Binds (path, likePrefix(path)). Never used for "/",
 * which contains everything and is handled by callers.
 */
const WITHIN = (column: string) => `(${column} = ? OR ${column} LIKE ? || '/%' ESCAPE '\\')`;
/** Same as WITHIN with numbered parameters: ?2 = path, ?3 = likePrefix(path). */
const WITHIN_NUMBERED = (column: string) =>
  `(${column} = ?2 OR ${column} LIKE ?3 || '/%' ESCAPE '\\')`;
/** Strictly inside `path`. Binds (likePrefix(path)), or matches every non-root path for "/". */
const BELOW = (column: string) => `${column} LIKE ? || '/%' ESCAPE '\\'`;

function belowBinding(path: string): string {
  return path === "/" ? "" : likePrefix(path);
}

function joinPath(parent: string, name: string): string {
  return parent === "/" ? `/${name}` : `${parent}/${name}`;
}

/** INSERT OR IGNORE statements for every ancestor of `path` (itself included), for a batch. */
export function ensureFolders(
  db: D1Database,
  environmentId: string,
  path: string,
  now: number,
): D1PreparedStatement[] {
  return ancestors(path).map((p) =>
    db
      .prepare(
        "INSERT OR IGNORE INTO folders (id, environment_id, path, created_at) VALUES (?, ?, ?, ?)",
      )
      .bind(newId(), environmentId, p, now),
  );
}

export async function folderExists(
  db: D1Database,
  environmentId: string,
  path: string,
): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM folders WHERE environment_id = ? AND path = ?")
    .bind(environmentId, path)
    .first();
  return row !== null;
}

/** Direct children of `parent`: explicit folder rows plus folders implied by secret paths. */
export async function listChildFolders(
  db: D1Database,
  environmentId: string,
  parent: string,
): Promise<FolderDto[]> {
  const prefix = belowBinding(parent);
  const { results } = await db
    .prepare(
      `SELECT path FROM folders WHERE environment_id = ? AND ${BELOW("path")}
       UNION
       SELECT DISTINCT path FROM secrets WHERE environment_id = ? AND ${BELOW("path")}`,
    )
    .bind(environmentId, prefix, environmentId, prefix)
    .all<{ path: string }>();
  const names = new Set<string>();
  for (const { path } of results) {
    const name = childSegment(parent, path);
    if (name) names.add(name);
  }
  return [...names].sort().map((name) => ({ path: joinPath(parent, name), name }));
}

export type DeleteFolderResult =
  | { status: "deleted"; secretsDeleted: number; foldersDeleted: number }
  | { status: "not_empty" }
  | { status: "not_found" };

/**
 * Deletes the folder at `path` (never "/"). Without `force`, only an empty folder goes: the
 * delete is guarded in SQL so a secret written after the emptiness check still blocks it. With
 * `force`, the secrets (versions cascade), folder rows and import rows inside it go in one batch.
 */
export async function deleteFolder(
  db: D1Database,
  environmentId: string,
  path: string,
  force: boolean,
): Promise<DeleteFolderResult> {
  const like = likePrefix(path);
  if (force) {
    const [secrets, folders, imports] = await db.batch([
      db
        .prepare(`DELETE FROM secrets WHERE environment_id = ? AND ${WITHIN("path")} RETURNING id`)
        .bind(environmentId, path, like),
      db
        .prepare(`DELETE FROM folders WHERE environment_id = ? AND ${WITHIN("path")} RETURNING id`)
        .bind(environmentId, path, like),
      db
        .prepare(
          `DELETE FROM folder_imports WHERE environment_id = ? AND ${WITHIN("path")} RETURNING id`,
        )
        .bind(environmentId, path, like),
    ]);
    // RETURNING counts the rows themselves; meta.changes would include cascaded version rows.
    const secretsDeleted = secrets?.results.length ?? 0;
    const foldersDeleted = folders?.results.length ?? 0;
    if (secretsDeleted + foldersDeleted + (imports?.results.length ?? 0) === 0) {
      return { status: "not_found" };
    }
    return deleted(secretsDeleted, foldersDeleted);
  }

  if (await hasContent(db, environmentId, path)) return { status: "not_empty" };
  const result = await db
    .prepare(
      `DELETE FROM folders WHERE environment_id = ?1 AND path = ?2
         AND NOT EXISTS (SELECT 1 FROM secrets WHERE environment_id = ?1 AND ${WITHIN_NUMBERED("path")})
         AND NOT EXISTS (SELECT 1 FROM folders WHERE environment_id = ?1 AND path LIKE ?3 || '/%' ESCAPE '\\')
         AND NOT EXISTS (SELECT 1 FROM folder_imports WHERE environment_id = ?1 AND ${WITHIN_NUMBERED("path")})`,
    )
    .bind(environmentId, path, like)
    .run();
  if (result.meta.changes === 1) return deleted(0, 1);
  // Nothing deleted: either it never existed, or content appeared after the check.
  if (await hasContent(db, environmentId, path)) return { status: "not_empty" };
  return { status: "not_found" };
}

function deleted(secretsDeleted: number, foldersDeleted: number): DeleteFolderResult {
  return { status: "deleted", secretsDeleted, foldersDeleted };
}

/** Secrets, subfolders or imports inside `path` (the folder row itself does not count). */
async function hasContent(db: D1Database, environmentId: string, path: string): Promise<boolean> {
  const like = likePrefix(path);
  const row = await db
    .prepare(
      `SELECT
         EXISTS (SELECT 1 FROM secrets WHERE environment_id = ?1 AND ${WITHIN_NUMBERED("path")}) AS s,
         EXISTS (SELECT 1 FROM folders WHERE environment_id = ?1 AND path LIKE ?3 || '/%' ESCAPE '\\') AS f,
         EXISTS (SELECT 1 FROM folder_imports WHERE environment_id = ?1 AND ${WITHIN_NUMBERED("path")}) AS i`,
    )
    .bind(environmentId, path, like)
    .first<{ s: number; f: number; i: number }>();
  return !!row && (row.s === 1 || row.f === 1 || row.i === 1);
}

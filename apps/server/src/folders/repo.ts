import type { FolderDto } from "@anchor/shared";
import { newId } from "../lib/random";
import { ancestors, childSegment } from "../secrets/paths";

/*
 * Prefix tests use GLOB, not LIKE: SQLite's LIKE ignores ASCII case, so `/api` would match
 * `/API/x`. GLOB is case-sensitive, and a normalized path ([A-Za-z0-9_-] segments joined by "/")
 * never contains a GLOB metacharacter (`*`, `?`, `[`), so the path is used as the pattern as is.
 */

/** SQL for "column is `path` or inside it". Binds (path, path). Never used for "/". */
const WITHIN = (column: string) => `(${column} = ? OR ${column} GLOB ? || '/*')`;
/** Same as WITHIN with numbered parameters: ?2 = path. */
const WITHIN_NUMBERED = (column: string) => `(${column} = ?2 OR ${column} GLOB ?2 || '/*')`;
/** Strictly inside `path`. Binds (belowBinding(path)); for "/" it matches every non-root path. */
const BELOW = (column: string) => `${column} GLOB ? || '/*'`;

function belowBinding(path: string): string {
  return path === "/" ? "" : path;
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
  | {
      status: "deleted";
      secretsDeleted: number;
      foldersDeleted: number;
      /** "<path>/<KEY>" of every deleted secret, sorted. */
      secrets: string[];
    }
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
  if (force) {
    const [secrets, folders, imports] = await db.batch([
      db
        .prepare(
          `DELETE FROM secrets WHERE environment_id = ? AND ${WITHIN("path")} RETURNING path, key`,
        )
        .bind(environmentId, path, path),
      db
        .prepare(`DELETE FROM folders WHERE environment_id = ? AND ${WITHIN("path")} RETURNING id`)
        .bind(environmentId, path, path),
      db
        .prepare(
          `DELETE FROM folder_imports WHERE environment_id = ? AND ${WITHIN("path")} RETURNING id`,
        )
        .bind(environmentId, path, path),
    ]);
    // RETURNING counts the rows themselves; meta.changes would include cascaded version rows.
    const gone = ((secrets?.results ?? []) as { path: string; key: string }[])
      .map((r) => `${r.path === "/" ? "" : r.path}/${r.key}`)
      .sort();
    const foldersDeleted = folders?.results.length ?? 0;
    if (gone.length + foldersDeleted + (imports?.results.length ?? 0) === 0) {
      return { status: "not_found" };
    }
    return deleted(gone, foldersDeleted);
  }

  if (await hasContent(db, environmentId, path)) return { status: "not_empty" };
  const result = await db
    .prepare(
      `DELETE FROM folders WHERE environment_id = ?1 AND path = ?2
         AND NOT EXISTS (SELECT 1 FROM secrets WHERE environment_id = ?1 AND ${WITHIN_NUMBERED("path")})
         AND NOT EXISTS (SELECT 1 FROM folders WHERE environment_id = ?1 AND path GLOB ?2 || '/*')
         AND NOT EXISTS (SELECT 1 FROM folder_imports WHERE environment_id = ?1 AND ${WITHIN_NUMBERED("path")})`,
    )
    .bind(environmentId, path)
    .run();
  if (result.meta.changes === 1) return deleted([], 1);
  // Nothing deleted: either it never existed, or content appeared after the check.
  if (await hasContent(db, environmentId, path)) return { status: "not_empty" };
  return { status: "not_found" };
}

function deleted(secrets: string[], foldersDeleted: number): DeleteFolderResult {
  return { status: "deleted", secretsDeleted: secrets.length, foldersDeleted, secrets };
}

/** Secrets, subfolders or imports inside `path` (the folder row itself does not count). */
async function hasContent(db: D1Database, environmentId: string, path: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT
         EXISTS (SELECT 1 FROM secrets WHERE environment_id = ?1 AND ${WITHIN_NUMBERED("path")}) AS s,
         EXISTS (SELECT 1 FROM folders WHERE environment_id = ?1 AND path GLOB ?2 || '/*') AS f,
         EXISTS (SELECT 1 FROM folder_imports WHERE environment_id = ?1 AND ${WITHIN_NUMBERED("path")}) AS i`,
    )
    .bind(environmentId, path)
    .first<{ s: number; f: number; i: number }>();
  return !!row && (row.s === 1 || row.f === 1 || row.i === 1);
}

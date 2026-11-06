import type { EnvironmentDto, ProjectDto } from "@anchor/shared";
import { createWrappedKek, ROOT_KEY_ID, unwrapKek } from "../crypto/keyring";
import type { Principal } from "../env";
import { isUniqueViolation, toBytes } from "../lib/d1";
import { ApiError, ConfigError, IntegrityError } from "../lib/errors";
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

/**
 * Refuses to wrap new key material under a root key that cannot open the keys already stored.
 * Without this, a mistyped ANCHOR_ROOT_KEY would split data across two root keys: old projects
 * fail closed while new ones silently work, and restoring either key breaks the other half.
 */
async function assertRootKeyMatchesStoredKeys(db: D1Database, rootKey: CryptoKey): Promise<void> {
  const row = await db
    .prepare(
      "SELECT project_id, version, iv, wrapped_key FROM project_keys WHERE root_key_id = ? LIMIT 1",
    )
    .bind(ROOT_KEY_ID)
    .first<{ project_id: string; version: number; iv: unknown; wrapped_key: unknown }>();
  if (!row) return;
  try {
    await unwrapKek(rootKey, {
      projectId: row.project_id,
      version: row.version,
      rootKeyId: ROOT_KEY_ID,
      iv: toBytes(row.iv),
      wrappedKey: toBytes(row.wrapped_key),
    });
  } catch (err) {
    if (err instanceof IntegrityError) {
      throw new ConfigError("ANCHOR_ROOT_KEY does not match the stored project keys");
    }
    throw err;
  }
}

export async function createProject(
  db: D1Database,
  rootKey: CryptoKey,
  input: { name: string; slug: string },
  now: number,
): Promise<ProjectRow> {
  await assertRootKeyMatchesStoredKeys(db, rootKey);
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

/**
 * Projects the principal may read, in one query: everything for instance owners/admins, member
 * projects for members, and the token's own project for service tokens. Mirrors authorize's
 * project:read rule.
 */
export async function listProjectsForPrincipal(
  db: D1Database,
  principal: Principal,
): Promise<ProjectRow[]> {
  if (principal.type === "user" && (principal.role === "owner" || principal.role === "admin")) {
    return listProjects(db);
  }
  const stmt =
    principal.type === "service_token"
      ? db
          .prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ? ORDER BY name, slug`)
          .bind(principal.projectId)
      : db
          .prepare(
            `SELECT ${PROJECT_COLUMNS} FROM projects
             WHERE id IN (SELECT project_id FROM project_members WHERE user_id = ?)
             ORDER BY name, slug`,
          )
          .bind(principal.userId);
  return (await stmt.all<ProjectRow>()).results;
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

const ENV_COLUMNS = "id, project_id, slug, name, position";

export async function listEnvironments(
  db: D1Database,
  projectId: string,
): Promise<EnvironmentRow[]> {
  const { results } = await db
    .prepare(`SELECT ${ENV_COLUMNS} FROM environments WHERE project_id = ? ORDER BY position`)
    .bind(projectId)
    .all<EnvironmentRow>();
  return results;
}

export async function getEnvironmentBySlug(
  db: D1Database,
  projectId: string,
  slug: string,
): Promise<EnvironmentRow> {
  const row = await db
    .prepare(`SELECT ${ENV_COLUMNS} FROM environments WHERE project_id = ? AND slug = ?`)
    .bind(projectId, slug)
    .first<EnvironmentRow>();
  if (!row) throw new ApiError(404, "not_found", "Environment not found");
  return row;
}

export async function createEnvironment(
  db: D1Database,
  projectId: string,
  input: { name: string; slug: string },
  now: number,
): Promise<EnvironmentRow> {
  const id = newId();
  try {
    await db
      .prepare(
        `INSERT INTO environments (id, project_id, slug, name, position, created_at)
         SELECT ?, ?, ?, ?, COALESCE(MAX(position), -1) + 1, ? FROM environments WHERE project_id = ?`,
      )
      .bind(id, projectId, input.slug, input.name, now, projectId)
      .run();
  } catch (err) {
    if (isUniqueViolation(err))
      throw new ApiError(409, "conflict", "Environment slug already exists");
    throw err;
  }
  return getEnvironmentBySlug(db, projectId, input.slug);
}

export async function renameEnvironment(
  db: D1Database,
  envId: string,
  name: string,
): Promise<void> {
  await db.prepare("UPDATE environments SET name = ? WHERE id = ?").bind(name, envId).run();
}

/** Deletes atomically unless it is the project's last environment (409). Cascades secrets. */
export async function deleteEnvironment(
  db: D1Database,
  projectId: string,
  envId: string,
): Promise<void> {
  const result = await db
    .prepare(
      `DELETE FROM environments WHERE id = ? AND project_id = ?
       AND (SELECT count(*) FROM environments WHERE project_id = ?) > 1`,
    )
    .bind(envId, projectId, projectId)
    .run();
  if (result.meta.changes === 0) {
    throw new ApiError(409, "conflict", "A project must keep at least one environment");
  }
}

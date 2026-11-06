import type { MemberDto, ProjectRole } from "@anchor/shared";
import { isUniqueViolation } from "../lib/d1";
import { ApiError } from "../lib/errors";

export type MembershipRow = {
  project_id: string;
  user_id: string;
  role: ProjectRole;
  /** null means every environment of the project. */
  environment_ids: string[] | null;
};

export async function getMembership(
  db: D1Database,
  projectId: string,
  userId: string,
): Promise<MembershipRow | null> {
  const row = await db
    .prepare(
      "SELECT project_id, user_id, role, environment_ids FROM project_members WHERE project_id = ? AND user_id = ?",
    )
    .bind(projectId, userId)
    .first<{
      project_id: string;
      user_id: string;
      role: ProjectRole;
      environment_ids: string | null;
    }>();
  if (!row) return null;
  return { ...row, environment_ids: parseEnvironmentIds(row.environment_ids) };
}

export function parseEnvironmentIds(raw: string | null): string[] | null {
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === "string")) {
    throw new Error("project_members.environment_ids is not a JSON string array");
  }
  return parsed;
}

type MemberJoinRow = {
  user_id: string;
  email: string;
  name: string;
  role: ProjectRole;
  environment_ids: string | null;
};

const MEMBER_SELECT = `SELECT m.user_id, u.email, u.name, m.role, m.environment_ids
  FROM project_members m JOIN users u ON u.id = m.user_id`;

async function environmentSlugsById(
  db: D1Database,
  projectId: string,
): Promise<Map<string, string>> {
  const { results } = await db
    .prepare("SELECT id, slug FROM environments WHERE project_id = ?")
    .bind(projectId)
    .all<{ id: string; slug: string }>();
  return new Map(results.map((e) => [e.id, e.slug]));
}

/**
 * Deleted environments are dropped from the list. A restriction that loses every environment
 * becomes [] (no access), never null (all environments).
 */
function toMemberDto(row: MemberJoinRow, envSlugById: Map<string, string>): MemberDto {
  const ids = parseEnvironmentIds(row.environment_ids);
  return {
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role,
    environments:
      ids === null
        ? null
        : ids.flatMap((id) => {
            const slug = envSlugById.get(id);
            return slug ? [slug] : [];
          }),
  };
}

export async function listMembers(db: D1Database, projectId: string): Promise<MemberDto[]> {
  const [members, envSlugById] = await Promise.all([
    db
      .prepare(`${MEMBER_SELECT} WHERE m.project_id = ? ORDER BY u.email`)
      .bind(projectId)
      .all<MemberJoinRow>(),
    environmentSlugsById(db, projectId),
  ]);
  return members.results.map((r) => toMemberDto(r, envSlugById));
}

export async function getMember(
  db: D1Database,
  projectId: string,
  userId: string,
): Promise<MemberDto | null> {
  const [row, envSlugById] = await Promise.all([
    db
      .prepare(`${MEMBER_SELECT} WHERE m.project_id = ? AND m.user_id = ?`)
      .bind(projectId, userId)
      .first<MemberJoinRow>(),
    environmentSlugsById(db, projectId),
  ]);
  return row ? toMemberDto(row, envSlugById) : null;
}

export async function addMember(
  db: D1Database,
  input: { projectId: string; userId: string; role: ProjectRole; environmentIds: string[] | null },
  now: number,
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO project_members (project_id, user_id, role, environment_ids, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.projectId,
        input.userId,
        input.role,
        input.environmentIds === null ? null : JSON.stringify(input.environmentIds),
        now,
        now,
      )
      .run();
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, "conflict", "User is already a member");
    throw err;
  }
}

/**
 * Applies the patch in one statement. The WHERE clause refuses a result where an admin keeps an
 * environment restriction, so a role-only change cannot leave a restricted admin behind.
 */
export async function updateMember(
  db: D1Database,
  projectId: string,
  userId: string,
  patch: { role?: ProjectRole; environmentIds?: string[] | null },
  now: number,
): Promise<"updated" | "not_found" | "admin_restricted"> {
  const setEnvs = patch.environmentIds !== undefined ? 1 : 0;
  const envs =
    patch.environmentIds === undefined || patch.environmentIds === null
      ? null
      : JSON.stringify(patch.environmentIds);
  const result = await db
    .prepare(
      `UPDATE project_members
       SET role = COALESCE(?1, role),
           environment_ids = CASE WHEN ?2 = 1 THEN ?3 ELSE environment_ids END,
           updated_at = ?4
       WHERE project_id = ?5 AND user_id = ?6
         AND NOT (COALESCE(?1, role) = 'admin'
                  AND (CASE WHEN ?2 = 1 THEN ?3 ELSE environment_ids END) IS NOT NULL)`,
    )
    .bind(patch.role ?? null, setEnvs, envs, now, projectId, userId)
    .run();
  if (result.meta.changes === 1) return "updated";
  return (await getMembership(db, projectId, userId)) ? "admin_restricted" : "not_found";
}

export async function removeMember(
  db: D1Database,
  projectId: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?")
    .bind(projectId, userId)
    .run();
  return result.meta.changes === 1;
}

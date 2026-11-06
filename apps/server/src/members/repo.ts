import type { ProjectRole } from "@anchor/shared";

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

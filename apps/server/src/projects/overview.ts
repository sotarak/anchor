import type { EnvironmentDto, OverviewDto, ProjectAccessDto, ProjectRole } from "@anchor/shared";
import type { Principal } from "../env";
import { parseEnvironmentIds } from "../members/repo";
import { type EnvironmentRow, toEnvironmentDto } from "./repo";

const FULL_ACCESS: ProjectAccessDto = { role: "admin", environments: null };

/**
 * The caller's access to each of the given projects, keyed by project id, in two queries.
 * Service tokens get no entry (access is reported for users only); a project the user is not a
 * member of gets no entry either. Environment ids are mapped to slugs in position order.
 */
export async function resolveProjectAccessMany(
  db: D1Database,
  principal: Principal,
  projectIds: string[],
): Promise<Map<string, ProjectAccessDto>> {
  const access = new Map<string, ProjectAccessDto>();
  if (principal.type !== "user" || projectIds.length === 0) return access;
  if (principal.role === "owner" || principal.role === "admin") {
    for (const id of projectIds) access.set(id, FULL_ACCESS);
    return access;
  }
  const ids = new Set(projectIds);
  const [memberships, environments] = await Promise.all([
    db
      .prepare("SELECT project_id, role, environment_ids FROM project_members WHERE user_id = ?")
      .bind(principal.userId)
      .all<{ project_id: string; role: ProjectRole; environment_ids: string | null }>(),
    db
      .prepare(
        `SELECT id, slug FROM environments
         WHERE project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)
         ORDER BY position`,
      )
      .bind(principal.userId)
      .all<{ id: string; slug: string }>(),
  ]);
  const slugById = new Map(environments.results.map((e) => [e.id, e.slug]));
  const order = new Map(environments.results.map((e, i) => [e.id, i]));
  for (const m of memberships.results) {
    if (!ids.has(m.project_id)) continue;
    const envIds = parseEnvironmentIds(m.environment_ids);
    access.set(m.project_id, {
      role: m.role,
      environments:
        envIds === null
          ? null
          : envIds
              .filter((id) => slugById.has(id))
              .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
              .map((id) => slugById.get(id) as string),
    });
  }
  return access;
}

/** The caller's access to one project; null when there is none (or for a service token). */
export async function resolveProjectAccess(
  db: D1Database,
  principal: Principal,
  projectId: string,
): Promise<ProjectAccessDto | null> {
  return (await resolveProjectAccessMany(db, principal, [projectId])).get(projectId) ?? null;
}

/**
 * Which keys exist in which of the given environments at one path: one query over `secrets`,
 * metadata only (nothing is decrypted). Keys ascend; a cell is null where the key is absent.
 */
export async function getOverview(
  db: D1Database,
  projectId: string,
  environments: EnvironmentRow[],
  path: string,
): Promise<OverviewDto> {
  const envDtos: EnvironmentDto[] = environments.map(toEnvironmentDto);
  if (environments.length === 0) return { environments: envDtos, keys: [] };
  const placeholders = environments.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT key, environment_id, current_version, updated_at FROM secrets
       WHERE project_id = ? AND path = ? AND environment_id IN (${placeholders})
       ORDER BY key`,
    )
    .bind(projectId, path, ...environments.map((e) => e.id))
    .all<{ key: string; environment_id: string; current_version: number; updated_at: number }>();
  const slugById = new Map(environments.map((e) => [e.id, e.slug]));
  const rows = new Map<string, OverviewDto["keys"][number]>();
  for (const r of results) {
    let row = rows.get(r.key);
    if (!row) {
      row = { key: r.key, cells: Object.fromEntries(environments.map((e) => [e.slug, null])) };
      rows.set(r.key, row);
    }
    const slug = slugById.get(r.environment_id);
    if (slug) row.cells[slug] = { version: r.current_version, updatedAt: r.updated_at };
  }
  return { environments: envDtos, keys: [...rows.values()] };
}

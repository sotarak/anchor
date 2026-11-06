import { env } from "cloudflare:workers";
import type { InstanceRole, ProjectRole } from "@anchor/shared";
import { createUserWithSession } from "./users";

/**
 * Inserts a user with a CLI session plus a membership on the project, directly in D1.
 * `environments` are env slugs; null (default) means every environment.
 */
export async function createMember(
  projectSlug: string,
  opts: { role: ProjectRole; environments?: string[] | null; instanceRole?: InstanceRole },
): Promise<{ userId: string; token: string }> {
  const project = await env.DB.prepare("SELECT id FROM projects WHERE slug = ?")
    .bind(projectSlug)
    .first<{ id: string }>();
  if (!project) throw new Error(`createMember: unknown project ${projectSlug}`);
  let environmentIds: string[] | null = null;
  if (opts.environments) {
    environmentIds = [];
    for (const slug of opts.environments) {
      const row = await env.DB.prepare(
        "SELECT id FROM environments WHERE project_id = ? AND slug = ?",
      )
        .bind(project.id, slug)
        .first<{ id: string }>();
      if (!row) throw new Error(`createMember: unknown environment ${slug}`);
      environmentIds.push(row.id);
    }
  }
  const { userId, token } = await createUserWithSession({
    role: opts.instanceRole ?? "member",
    kind: "cli",
  });
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO project_members (project_id, user_id, role, environment_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      project.id,
      userId,
      opts.role,
      environmentIds ? JSON.stringify(environmentIds) : null,
      now,
      now,
    )
    .run();
  return { userId, token };
}

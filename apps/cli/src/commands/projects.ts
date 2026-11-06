import { authedApi } from "../auth";
import type { CommandContext } from "../context";
import { formatDate } from "../format/dates";

export async function projectsList(ctx: CommandContext): Promise<void> {
  const { api } = await authedApi(ctx);
  const projects = await api.listProjects();
  if (projects.length === 0 && !ctx.flags.json) {
    ctx.out.info("No projects yet. Create one in the dashboard.");
    return;
  }
  ctx.out.data({ projects }, () =>
    ctx.out.table(
      ["SLUG", "NAME", "CREATED"],
      projects.map((p) => [p.slug, p.name, formatDate(p.createdAt)]),
    ),
  );
}

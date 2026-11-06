import { authedApi } from "../auth";
import { type CommandContext, requireProject } from "../context";

export async function envsList(ctx: CommandContext): Promise<void> {
  const project = requireProject(ctx);
  const { api } = await authedApi(ctx);
  const environments = await api.listEnvironments(project);
  ctx.out.data({ environments }, () =>
    ctx.out.table(
      ["SLUG", "NAME"],
      environments.map((e) => [e.slug, e.name]),
    ),
  );
}

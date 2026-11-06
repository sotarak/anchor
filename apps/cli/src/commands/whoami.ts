import { authedApi } from "../auth";
import type { CommandContext } from "../context";
import { CliError, EXIT } from "../errors";

export async function whoami(ctx: CommandContext): Promise<void> {
  const { api, auth } = await authedApi(ctx);
  const me = await api.me();
  if (me.user) {
    const user = me.user;
    ctx.out.data(
      { apiUrl: auth.apiUrl, type: "user", user },
      () => `${user.email} (${user.role}) at ${auth.apiUrl}`,
    );
    return;
  }
  if (me.serviceToken) {
    const t = me.serviceToken;
    ctx.out.data(
      { apiUrl: auth.apiUrl, type: "service_token", serviceToken: t },
      () =>
        `service token ${t.name} (${t.permission}) for project ${t.projectSlug} at ${auth.apiUrl}`,
    );
    return;
  }
  throw new CliError(EXIT.ERROR, "Unexpected response from server");
}

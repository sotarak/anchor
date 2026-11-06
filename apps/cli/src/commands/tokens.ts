import { normalizeSecretPath, type ServiceTokenDto, slugSchema } from "@anchor/shared";
import { authedApi } from "../auth";
import { confirmDestructive } from "../confirm";
import { type CommandContext, requireProject } from "../context";
import { CliError, EXIT } from "../errors";
import { formatDate } from "../format/dates";

export type Scope = { environment: string; path: string };

/** `prod` → prod:/, `prod:/api` → prod:/api. */
export function parseScope(input: string): Scope {
  const [environment = "", rawPath] = input.split(/:(.*)/s);
  const invalid = () =>
    new CliError(EXIT.USAGE, `Invalid scope '${input}'`, "Use <env> or <env>:<path>");
  if (!slugSchema.safeParse(environment).success) throw invalid();
  try {
    return { environment, path: normalizeSecretPath(rawPath ?? "/") };
  } catch {
    throw invalid();
  }
}

function parseDays(input: string): number {
  const days = /^\d+$/.test(input) ? Number(input) : Number.NaN;
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new CliError(EXIT.USAGE, "--expires-in must be a whole number of days between 1 and 365");
  }
  return days;
}

export async function tokensCreate(
  ctx: CommandContext,
  opts: { name: string; scope?: string[]; permission: "read" | "read-write"; expiresIn: string },
): Promise<void> {
  const project = requireProject(ctx);
  const expiresInDays = parseDays(opts.expiresIn);
  const scopes = (opts.scope?.length ? opts.scope : [ctx.config.env.value]).map(parseScope);
  const { api } = await authedApi(ctx);
  const res = await api.createServiceToken(project, {
    name: opts.name,
    permission: opts.permission,
    scopes,
    expiresInDays,
  });
  const t = res.serviceToken;
  ctx.out.info(
    `Created service token ${t.name} (${t.permission}), expires ${new Date(t.expiresAt).toISOString()}`,
  );
  ctx.out.info("Store this token now; it will not be shown again.");
  ctx.out.data(res, () => res.token);
}

function status(t: ServiceTokenDto, now: number): "active" | "expired" | "revoked" {
  if (t.revokedAt !== null) return "revoked";
  return t.expiresAt <= now ? "expired" : "active";
}

export async function tokensList(ctx: CommandContext): Promise<void> {
  const project = requireProject(ctx);
  const { api } = await authedApi(ctx);
  const serviceTokens = await api.listServiceTokens(project);
  const now = Date.now();
  ctx.out.data({ serviceTokens }, () =>
    ctx.out.table(
      ["ID", "NAME", "PREFIX", "PERMISSION", "SCOPES", "EXPIRES", "LAST USED", "STATUS"],
      serviceTokens.map((t) => [
        t.id,
        t.name,
        t.tokenPrefix,
        t.permission,
        t.scopes.map((s) => `${s.environment}:${s.path}`).join(","),
        formatDate(t.expiresAt),
        t.lastUsedAt === null ? "never" : formatDate(t.lastUsedAt),
        status(t, now),
      ]),
    ),
  );
}

export async function tokensRevoke(ctx: CommandContext, id: string): Promise<void> {
  const project = requireProject(ctx);
  await confirmDestructive(ctx, `Revoke service token ${id}?`);
  const { api } = await authedApi(ctx);
  await api.revokeServiceToken(project, id);
  ctx.out.data({ revoked: id }, () => `Revoked service token ${id}`);
}

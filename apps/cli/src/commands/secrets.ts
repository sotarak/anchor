import { type SecretDto, secretKeySchema } from "@anchor/shared";
import { authedApi } from "../auth";
import { confirmDestructive } from "../confirm";
import { type CommandContext, requireProject } from "../context";
import { CliError, EXIT } from "../errors";
import { formatDate } from "../format/dates";
import { readSecretValue } from "../secret-input";

const MASK = "********";

function scope(ctx: CommandContext) {
  return { project: requireProject(ctx), env: ctx.config.env.value, path: ctx.config.path.value };
}

function validKey(key: string): string {
  if (!secretKeySchema.safeParse(key).success) {
    throw new CliError(
      EXIT.USAGE,
      `Invalid key '${key}'`,
      "Keys start with a letter or underscore and contain only letters, digits and underscores",
    );
  }
  return key;
}

const where = (s: { env: string; path: string }) => `${s.env}:${s.path}`;

export async function secretsList(ctx: CommandContext, opts: { reveal: boolean }): Promise<void> {
  const s = scope(ctx);
  const { api } = await authedApi(ctx);
  const secrets = await api.listSecrets(s.project, s.env, { path: s.path, reveal: opts.reveal });
  if (secrets.length === 0 && !ctx.flags.json) {
    ctx.out.info(`No secrets in ${where(s)}`);
    return;
  }
  const headers = ["KEY", "VERSION", "UPDATED", "COMMENT", ...(opts.reveal ? ["VALUE"] : [])];
  ctx.out.data({ secrets }, () =>
    ctx.out.table(
      headers,
      secrets.map((x) => [
        x.key,
        String(x.version),
        formatDate(x.updatedAt),
        x.comment,
        ...(opts.reveal ? [x.value ?? ""] : []),
      ]),
    ),
  );
}

/**
 * Shows the value only with --reveal or when stdout is not a terminal. A masked view reads
 * metadata only, so the server records no read of the value.
 */
export async function secretsGet(
  ctx: CommandContext,
  key: string,
  opts: { reveal: boolean },
): Promise<void> {
  validKey(key);
  const s = scope(ctx);
  const showValue = opts.reveal || !ctx.deps.io.stdoutIsTTY;
  const { api } = await authedApi(ctx);
  let secret: SecretDto;
  if (showValue) {
    secret = await api.getSecret(s.project, s.env, key, { path: s.path });
  } else {
    const found = (await api.listSecrets(s.project, s.env, { path: s.path, reveal: false })).find(
      (x) => x.key === key,
    );
    if (!found) throw new CliError(EXIT.NOT_FOUND, `Secret ${key} not found in ${where(s)}`);
    secret = found;
  }
  if (ctx.flags.json) {
    const { value: _value, ...metaOnly } = secret;
    ctx.out.data({ secret: showValue ? secret : metaOnly }, () => "");
    return;
  }
  if (showValue && !ctx.deps.io.stdoutIsTTY) {
    ctx.out.raw(secret.value ?? "");
    return;
  }
  const rows: [string, string][] = [
    ["KEY", secret.key],
    ["PATH", secret.path],
    ["VERSION", String(secret.version)],
    ["UPDATED", formatDate(secret.updatedAt)],
    ["COMMENT", secret.comment],
    ["VALUE", showValue ? (secret.value ?? "") : MASK],
  ];
  ctx.out.data({ secret }, () => rows.map(([k, v]) => `${k.padEnd(9)}${v}`.trimEnd()).join("\n"));
  if (!showValue) ctx.out.info("Use --reveal to show the value");
}

export async function secretsSet(
  ctx: CommandContext,
  key: string,
  opts: { fromFile?: string; comment?: string },
): Promise<void> {
  validKey(key);
  const s = scope(ctx);
  const { api } = await authedApi(ctx);
  const value = await readSecretValue(ctx, key, opts);
  // Metadata only (no values, not audited): the previous version tells "Unchanged" from
  // "Updated", and an omitted --comment keeps the existing comment.
  const previous = (await api.listSecrets(s.project, s.env, { path: s.path, reveal: false })).find(
    (x) => x.key === key,
  );
  const comment = opts.comment ?? previous?.comment;
  const body = { value, path: s.path, ...(comment ? { comment } : {}) };
  const { secret, created } = await api.putSecret(s.project, s.env, key, body);
  ctx.out.data({ secret, created }, () => {
    if (created) return `Created ${key} (v${secret.version}) in ${where(s)}`;
    if (previous?.version === secret.version) return `Unchanged ${key} (v${secret.version})`;
    return `Updated ${key} (v${secret.version}) in ${where(s)}`;
  });
}

export async function secretsDelete(ctx: CommandContext, key: string): Promise<void> {
  validKey(key);
  const s = scope(ctx);
  await confirmDestructive(ctx, `Delete ${key} from ${s.project}/${where(s)}?`);
  const { api } = await authedApi(ctx);
  await api.deleteSecret(s.project, s.env, key, { path: s.path });
  ctx.out.data(
    { deleted: { key, environment: s.env, path: s.path } },
    () => `Deleted ${key} from ${where(s)}`,
  );
}

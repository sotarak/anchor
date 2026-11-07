import {
  checkTypedValue,
  type SecretDto,
  type SecretValueType,
  type SecretVersionDto,
  secretKeySchema,
} from "@anchor/shared";
import { positionals } from "../argv";
import { authedApi } from "../auth";
import { confirmDestructive } from "../confirm";
import { type CommandContext, requireProject } from "../context";
import { CliError, EXIT, withExpandHint } from "../errors";
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

const where = (s: { env: string; path: string } | { environment: string; path: string }) =>
  `${"env" in s ? s.env : s.environment}:${s.path}`;
const NONE = "–";

/** A version number flag: a positive integer, as the API accepts it. */
export function parseVersionNumber(flag: string, raw: string): number {
  if (!/^[1-9][0-9]{0,9}$/.test(raw)) {
    throw new CliError(EXIT.USAGE, `${flag} must be a positive integer, got '${raw}'`);
  }
  return Number(raw);
}

/**
 * The root `--version` is a global flag, so `secrets get KEY --version 2` would print the CLI
 * version (into a file, if redirected) instead of the secret. Refuse it with the right flag.
 */
export function assertNoVersionFlagOnGet(argv: string[]): void {
  const [noun, verb] = positionals(argv);
  if (noun?.value !== "secrets" || verb?.value !== "get") return;
  const end = argv.indexOf("--");
  if (!(end === -1 ? argv : argv.slice(0, end)).includes("--version")) return;
  throw new CliError(
    EXIT.USAGE,
    "--version prints the CLI version",
    "Use --at-version <n> to read a past version",
  );
}

export async function secretsList(ctx: CommandContext, opts: { reveal: boolean }): Promise<void> {
  const s = scope(ctx);
  const { api } = await authedApi(ctx);
  const secrets = await api.listSecrets(s.project, s.env, { path: s.path, reveal: opts.reveal });
  if (secrets.length === 0 && !ctx.flags.json) {
    ctx.out.info(`No secrets in ${where(s)}`);
    return;
  }
  // Non-sensitive values come back without --reveal, so they get a VALUE column too.
  // `sensitive === false`, not `!sensitive`: a 0.3.x server sends no flag, and that means masked.
  const showValues = opts.reveal || secrets.some((x) => x.sensitive === false);
  const headers = [
    "KEY",
    "TYPE",
    "VERSION",
    "UPDATED",
    "COMMENT",
    ...(showValues ? ["VALUE"] : []),
  ];
  ctx.out.data({ secrets }, () =>
    ctx.out.table(
      headers,
      secrets.map((x) => [
        x.key,
        x.type ?? "string",
        String(x.version),
        formatDate(x.updatedAt),
        x.comment,
        ...(showValues ? [opts.reveal || x.sensitive === false ? (x.value ?? "") : MASK] : []),
      ]),
    ),
  );
}

/**
 * Shows the value only with --reveal or when stdout is not a terminal. A masked view reads
 * metadata only, so the server records no read of the value. With `atVersion` it reads a past
 * version (stored value, never expanded).
 */
export async function secretsGet(
  ctx: CommandContext,
  key: string,
  opts: { reveal: boolean; expand: boolean; atVersion?: string },
): Promise<void> {
  validKey(key);
  const version =
    opts.atVersion === undefined ? undefined : parseVersionNumber("--at-version", opts.atVersion);
  if (version !== undefined) return secretsGetVersion(ctx, key, version, opts);
  const s = scope(ctx);
  let showValue = opts.reveal || !ctx.deps.io.stdoutIsTTY;
  const { api } = await authedApi(ctx);
  let secret: SecretDto;
  if (showValue) {
    secret = await withExpandHint(
      opts.expand,
      api.getSecret(s.project, s.env, key, {
        path: s.path,
        expand: opts.expand,
        includeImports: true,
      }),
    );
  } else {
    // Local first: a local key must not depend on whether every import is readable.
    const lookup = async (includeImports: boolean) =>
      (
        await api.listSecrets(s.project, s.env, {
          path: s.path,
          reveal: false,
          ...(includeImports ? { includeImports } : {}),
        })
      ).find((x) => x.key === key);
    const found = (await lookup(false)) ?? (await lookup(true));
    if (!found) throw new CliError(EXIT.NOT_FOUND, `Secret ${key} not found in ${where(s)}`);
    secret = found;
    // A non-sensitive value is plain config: the list already returned it.
    if (found.sensitive === false) showValue = true;
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
    ...(secret.importedFrom ? [["IMPORTED", where(secret.importedFrom)] as [string, string]] : []),
    ["VALUE", showValue ? (secret.value ?? "") : MASK],
  ];
  printRows(ctx, { secret }, rows);
  if (!showValue) ctx.out.info("Use --reveal to show the value");
}

function printRows(ctx: CommandContext, json: unknown, rows: [string, string][]): void {
  ctx.out.data(json, () => rows.map(([k, v]) => `${k.padEnd(9)}${v}`.trimEnd()).join("\n"));
}

/** Same reveal rules as `get`; a masked view lists version metadata (not audited). */
async function secretsGetVersion(
  ctx: CommandContext,
  key: string,
  version: number,
  opts: { reveal: boolean },
): Promise<void> {
  const s = scope(ctx);
  const showValue = opts.reveal || !ctx.deps.io.stdoutIsTTY;
  const { api } = await authedApi(ctx);
  let found: SecretVersionDto & { value?: string };
  if (showValue) {
    found = await api.getSecretVersion(s.project, s.env, key, version, { path: s.path });
  } else {
    const match = (await api.listVersions(s.project, s.env, key, { path: s.path })).find(
      (v) => v.version === version,
    );
    if (!match) {
      throw new CliError(EXIT.NOT_FOUND, `Version ${version} of ${key} not found in ${where(s)}`);
    }
    found = match;
  }
  if (ctx.flags.json) {
    const { value: _value, ...metaOnly } = found;
    ctx.out.data({ version: showValue ? found : metaOnly }, () => "");
    return;
  }
  if (showValue && !ctx.deps.io.stdoutIsTTY) {
    ctx.out.raw(found.value ?? "");
    return;
  }
  printRows(ctx, { version: found }, [
    ["KEY", key],
    ["PATH", s.path],
    ["VERSION", String(found.version)],
    ["CREATED", formatDate(found.createdAt)],
    ["AUTHOR", found.createdBy?.label ?? NONE],
    ["COMMENT", found.comment],
    ["VALUE", showValue ? (found.value ?? "") : MASK],
  ]);
  if (!showValue) ctx.out.info("Use --reveal to show the value");
}

export async function secretsHistory(ctx: CommandContext, key: string): Promise<void> {
  validKey(key);
  const s = scope(ctx);
  const { api } = await authedApi(ctx);
  const versions = await api.listVersions(s.project, s.env, key, { path: s.path });
  ctx.out.data(versions, () =>
    ctx.out.table(
      ["VERSION", "COMMENT", "AUTHOR", "DATE"],
      versions.map((v) => [
        String(v.version),
        v.comment || NONE,
        v.createdBy?.label ?? NONE,
        formatDate(v.createdAt),
      ]),
    ),
  );
}

export async function secretsRollback(
  ctx: CommandContext,
  key: string,
  opts: { to: string },
): Promise<void> {
  validKey(key);
  const version = parseVersionNumber("--to", opts.to);
  const s = scope(ctx);
  await confirmDestructive(ctx, `Roll back ${key} in ${where(s)} to version ${version}?`);
  const { api } = await authedApi(ctx);
  const { secret, changed } = await api.rollbackSecret(s.project, s.env, key, {
    path: s.path,
    version,
  });
  if (ctx.flags.json) {
    ctx.out.data({ secret, changed }, () => "");
    return;
  }
  ctx.out.info(
    changed
      ? `Rolled back to v${version} (new version v${secret.version})`
      : "Already at that content",
  );
}

export async function secretsSet(
  ctx: CommandContext,
  key: string,
  opts: { fromFile?: string; comment?: string; type?: SecretValueType; sensitive?: boolean },
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
  // The server inherits an omitted type, so check against the same one before sending.
  const type = opts.type ?? previous?.type ?? "string";
  const check = checkTypedValue(type, value);
  if (!check.ok) {
    throw new CliError(
      EXIT.USAGE,
      `Value of ${key} is not valid for type ${type}: ${check.reason}`,
    );
  }
  const body = {
    value,
    path: s.path,
    ...(comment ? { comment } : {}),
    ...(opts.type ? { type: opts.type } : {}),
    ...(opts.sensitive !== undefined ? { sensitive: opts.sensitive } : {}),
  };
  const { secret, created } = await api.putSecret(s.project, s.env, key, body);
  if (
    ignoredTypedFields(secret, { type: opts.type ?? "string", sensitive: opts.sensitive ?? true })
  ) {
    throw new CliError(
      EXIT.ERROR,
      `The server is older than 0.4.0 and stored ${key} as a sensitive string`,
      "Upgrade the server to 0.4.0 to use types and plain config",
    );
  }
  ctx.out.data({ secret, created }, () => {
    if (created) return `Created ${key} (v${secret.version}) in ${where(s)}`;
    if (previous?.version === secret.version) return `Unchanged ${key} (v${secret.version})`;
    return `Updated ${key} (v${secret.version}) in ${where(s)}`;
  });
}

/**
 * True when a write asked for a type or flag other than a sensitive string and the response has
 * no `type`: a 0.3.x server dropped both fields and stored a sensitive string.
 */
export function ignoredTypedFields(
  secret: SecretDto,
  wanted: { type: SecretValueType; sensitive: boolean },
): boolean {
  return secret.type === undefined && (wanted.type !== "string" || !wanted.sensitive);
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

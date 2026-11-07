import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SecretValueType } from "@anchor/shared";
import { ApiRequestError } from "../api/http";
import { authedApi } from "../auth";
import { type CommandContext, requireProject } from "../context";
import { CliError, EXIT } from "../errors";
import { matchGlob } from "../import/glob";
import {
  type ImportEntry,
  type ImportFormat,
  inferImportFormat,
  parseImport,
} from "../import/parse";
import { ignoredTypedFields } from "./secrets";

export type SecretsImportOptions = {
  fromFile?: string;
  format?: ImportFormat;
  overwrite: boolean;
  nonSensitive: string[];
  comment?: string;
  dryRun: boolean;
};

type Action = "create" | "update" | "unchanged" | "skip";
type Planned = ImportEntry & { sensitive: boolean; action: Action; comment?: string };

const FORMAT_HINT = "Pass --format dotenv|json|yaml";
const NONE = "–";

/** The file text and its format, read the way `secrets set` reads a value. */
async function readInput(
  ctx: CommandContext,
  opts: SecretsImportOptions,
): Promise<{ text: string; format: ImportFormat }> {
  const { io } = ctx.deps;
  if (opts.fromFile !== undefined) {
    const format = opts.format ?? inferImportFormat(opts.fromFile);
    if (!format) {
      throw new CliError(EXIT.USAGE, `Cannot tell the format of ${opts.fromFile}`, FORMAT_HINT);
    }
    try {
      return { text: await readFile(resolve(io.cwd, opts.fromFile), "utf8"), format };
    } catch {
      throw new CliError(EXIT.USAGE, `Cannot read ${opts.fromFile}`);
    }
  }
  if (io.stdinIsTTY) {
    throw new CliError(EXIT.USAGE, "Pass --from-file <path> or pipe the file on stdin");
  }
  if (!opts.format) throw new CliError(EXIT.USAGE, `${FORMAT_HINT} when reading stdin`);
  return { text: await io.readStdin(), format: opts.format };
}

function failure(e: unknown): string {
  if (e instanceof CliError || e instanceof ApiRequestError) return e.message;
  throw e;
}

/**
 * Loads a dotenv, JSON or YAML file into one environment and folder. Everything is parsed and
 * validated before any request; existing keys are skipped unless `overwrite`; writes go one at
 * a time in key order and stop at the first failure, so a re-run resumes. Never prints values.
 */
export async function secretsImport(
  ctx: CommandContext,
  opts: SecretsImportOptions,
): Promise<void> {
  const { text, format } = await readInput(ctx, opts);
  const parsed = parseImport(text, format);
  const s = {
    project: requireProject(ctx),
    env: ctx.config.env.value,
    path: ctx.config.path.value,
  };
  const where = `${s.env}:${s.path}`;
  const { api } = await authedApi(ctx);
  const existing = new Map(
    (await api.listSecrets(s.project, s.env, { path: s.path, reveal: false })).map((x) => [
      x.key,
      x,
    ]),
  );

  const plan: Planned[] = [...parsed.entries]
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((entry) => {
      const sensitive = !opts.nonSensitive.some((g) => matchGlob(g, entry.key));
      const current = existing.get(entry.key);
      const action: Action = !current ? "create" : opts.overwrite ? "update" : "skip";
      // An omitted comment keeps the current one, so an identical re-run is a no-op.
      const comment = opts.comment ?? current?.comment;
      return { ...entry, sensitive, action, ...(comment ? { comment } : {}) };
    });

  const writes = plan.filter((p) => p.action !== "skip");
  if (!opts.dryRun) {
    if (writes.length > 0) ctx.out.info(`Writing ${writes.length} secrets to ${where}...`);
    let done = 0;
    for (const p of writes) {
      const body = {
        value: p.value,
        path: s.path,
        type: p.type as SecretValueType,
        sensitive: p.sensitive,
        ...(p.comment ? { comment: p.comment } : {}),
      };
      let written: Awaited<ReturnType<typeof api.putSecret>>;
      try {
        written = await api.putSecret(s.project, s.env, p.key, body);
      } catch (e) {
        throw new CliError(
          EXIT.ERROR,
          `Imported ${done} of ${writes.length}; ${p.key} failed: ${failure(e)}. Re-run to continue`,
        );
      }
      if (ignoredTypedFields(written.secret, p)) {
        throw new CliError(
          EXIT.ERROR,
          `Imported ${done} of ${writes.length}; the server is older than 0.4.0 and stored ${p.key} as a sensitive string`,
          "Upgrade the server to 0.4.0, then re-run with --overwrite",
        );
      }
      if (!written.created && existing.get(p.key)?.version === written.secret.version) {
        p.action = "unchanged";
      }
      done++;
    }
  }

  const keys = (a: Action) => plan.filter((p) => p.action === a).map((p) => p.key);
  const result = {
    ...(opts.dryRun ? { dryRun: true } : {}),
    created: keys("create"),
    updated: keys("update"),
    unchanged: keys("unchanged"),
    skipped: keys("skip"),
    empty: parsed.empty,
  };
  ctx.out.data(result, () => {
    const table = ctx.out.table(
      ["KEY", "TYPE", "SENSITIVE", "ACTION"],
      [
        ...plan.map((p) => [p.key, p.type, p.sensitive ? "yes" : "no", p.action]),
        ...parsed.empty.map((source) => [source, NONE, NONE, "empty"]),
      ],
    );
    const c = result.created.length;
    const u = result.updated.length;
    const k = result.skipped.length;
    const e = result.empty.length;
    const summary = opts.dryRun
      ? `Dry run: would create ${c}, update ${u}, skip ${k} existing, ${e} empty in ${where}`
      : `Created ${c}, updated ${u}, ${
          result.unchanged.length ? `${result.unchanged.length} unchanged, ` : ""
        }skipped ${k} existing, ${e} empty in ${where}`;
    return plan.length + e > 0 ? `${table}\n${summary}` : summary;
  });
}

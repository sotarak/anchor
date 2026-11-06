import type { SecretDto } from "@anchor/shared";
import { authorize } from "../authz/policy";
import type { Principal } from "../env";
import { listImports } from "../imports/repo";
import { ApiError } from "../lib/errors";
import { type EnvironmentRow, listEnvironments } from "../projects/repo";
import { createResolver, type SecretAddress } from "../references/resolve";
import { findSecretWithVersion, listSecretsWithVersions, type SecretWithVersion } from "./repo";
import { decryptVersion, type KekCache, type SecretContext } from "./service";

export type ComposeContext = SecretContext & { principal: Principal };
export type ImportSource = { environment: string; path: string };
export type Composed = { referenced: SecretAddress[]; imports: ImportSource[] };

/** Where a secret was read from: the requested folder, or one of its imports. */
type Source = { environment: EnvironmentRow; path: string; importedFrom?: ImportSource };

/**
 * One read request: environments looked up once, one KEK cache, one resolver (so a diamond of
 * references loads its tip once and the per-request limits apply across all returned values).
 */
function createReadSession(ctx: ComposeContext) {
  const cache: KekCache = new Map();
  let environments: Promise<EnvironmentRow[]> | undefined;
  const allEnvironments = () => {
    environments ??= listEnvironments(ctx.db, ctx.project.id);
    return environments;
  };
  const bySlug = async (slug: string) => (await allEnvironments()).find((e) => e.slug === slug);
  const byId = async (id: string) => (await allEnvironments()).find((e) => e.id === id);

  const decrypt = (environment: EnvironmentRow, found: SecretWithVersion) =>
    decryptVersion(
      { ...ctx, environment },
      cache,
      found.secret.id,
      found.current,
      found.secret.current_version,
    );

  const resolver = createResolver({
    // Authorization comes first and does not depend on existence: an unknown environment is
    // checked against an id nobody is scoped to, so restricted callers get the same 403.
    authorize: async (addr) => {
      const environment = await bySlug(addr.environment);
      await authorize(ctx.db, ctx.principal, "secret:read", {
        projectId: ctx.project.id,
        environmentId: environment?.id ?? "",
        path: addr.path,
      });
    },
    load: async (addr) => {
      const environment = await bySlug(addr.environment);
      if (!environment) return null;
      const found = await findSecretWithVersion(ctx.db, environment.id, addr.path, addr.key);
      return found ? decrypt(environment, found) : null;
    },
  });

  /** Throws a 403 naming the import when the caller cannot read its source folder. */
  async function authorizeImport(source: Source, path: string): Promise<void> {
    try {
      await authorize(ctx.db, ctx.principal, "secret:read", {
        projectId: ctx.project.id,
        environmentId: source.environment.id,
        path: source.path,
      });
    } catch (e) {
      // The caller can list this folder's imports, so naming the source reveals nothing new.
      if (e instanceof ApiError && e.status === 403) {
        throw new ApiError(
          403,
          "forbidden",
          `You do not have permission to read the import ${source.environment.slug}:${source.path} of ${ctx.environment.slug}:${path}`,
        );
      }
      throw e;
    }
  }

  /**
   * The requested folder, then each import, NOT yet authorized: the caller authorizes an import
   * (`authorizeImport`) before reading from it.
   */
  async function candidates(path: string, includeImports: boolean): Promise<Source[]> {
    const out: Source[] = [{ environment: ctx.environment, path }];
    if (!includeImports) return out;
    for (const row of await listImports(ctx.db, ctx.environment.id, path)) {
      const environment = await byId(row.source_environment_id);
      if (!environment) continue; // deleted concurrently; its import row cascades away
      out.push({
        environment,
        path: row.source_path,
        importedFrom: { environment: environment.slug, path: row.source_path },
      });
    }
    return out;
  }

  const referenced = new Map<string, SecretAddress>();

  /** Expands `dto.value` in place relative to where the secret is stored. */
  async function expandInto(dto: SecretDto, source: Source): Promise<void> {
    if (dto.value === undefined) return;
    const origin = { environment: source.environment.slug, path: source.path, key: dto.key };
    const out = await resolver.expand(origin, dto.value);
    for (const a of out.referenced) referenced.set(`${a.environment}:${a.path}:${a.key}`, a);
    if (out.value !== dto.value) {
      dto.rawValue = dto.value;
      dto.value = out.value;
    }
  }

  return {
    candidates,
    authorizeImport,
    decrypt,
    expandInto,
    referenced: () => [...referenced.values()],
  };
}

function toDto(found: SecretWithVersion, source: Source, value?: string): SecretDto {
  const dto: SecretDto = {
    key: found.secret.key,
    path: found.secret.path,
    version: found.secret.current_version,
    comment: found.current?.comment ?? "",
    updatedAt: found.secret.updated_at,
  };
  if (value !== undefined) dto.value = value;
  if (source.importedFrom) dto.importedFrom = source.importedFrom;
  return dto;
}

const importsOf = (sources: Source[]) =>
  sources.flatMap((s) => (s.importedFrom ? [s.importedFrom] : []));

/**
 * Lists a folder: local secrets, then imported ones whose key is not already taken (earlier
 * imports win). Values only with `reveal`; `expand` only applies to returned values.
 */
export async function composeSecrets(
  ctx: ComposeContext,
  opts: { path: string; reveal: boolean; expand: boolean; includeImports: boolean },
): Promise<{ secrets: SecretDto[] } & Composed> {
  const session = createReadSession(ctx);
  const sources = await session.candidates(opts.path, opts.includeImports);
  // A list covers every source, so every import is authorized up front: one forbidden source = 403.
  for (const source of sources) {
    if (source.importedFrom) await session.authorizeImport(source, opts.path);
  }
  const taken = new Set<string>();
  const secrets: SecretDto[] = [];
  for (const source of sources) {
    for (const found of await listSecretsWithVersions(ctx.db, source.environment.id, source.path)) {
      if (taken.has(found.secret.key)) continue;
      taken.add(found.secret.key);
      const value = opts.reveal ? await session.decrypt(source.environment, found) : undefined;
      const dto = toDto(found, source, value);
      if (opts.reveal && opts.expand) await session.expandInto(dto, source);
      secrets.push(dto);
    }
  }
  return { secrets, referenced: session.referenced(), imports: importsOf(sources) };
}

/**
 * One secret with its value: local first, then the imports in order. An import is authorized
 * only when the lookup reaches it, so a local key never depends on the imports, while an imported
 * or missing key behind a forbidden import is a 403 (its answer would come from that import).
 */
export async function composeSecret(
  ctx: ComposeContext,
  opts: { path: string; key: string; expand: boolean; includeImports: boolean },
): Promise<{ secret: SecretDto } & Composed> {
  const session = createReadSession(ctx);
  const consulted: Source[] = [];
  for (const source of await session.candidates(opts.path, opts.includeImports)) {
    if (source.importedFrom) await session.authorizeImport(source, opts.path);
    consulted.push(source);
    const found = await findSecretWithVersion(ctx.db, source.environment.id, source.path, opts.key);
    if (!found) continue;
    const dto = toDto(found, source, await session.decrypt(source.environment, found));
    if (opts.expand) await session.expandInto(dto, source);
    return { secret: dto, referenced: session.referenced(), imports: importsOf(consulted) };
  }
  throw new ApiError(404, "not_found", "Secret not found");
}

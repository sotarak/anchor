import { cacheKey, SecretCache } from "./cache.js";
import {
  type Config,
  cachePolicy,
  DEFAULT_TTL_MS,
  emitSafely,
  resolveConfig,
  validateOptions,
} from "./config.js";
import { decodeAll, toSecret, type WireSecret } from "./decode.js";
import { AnchorError } from "./errors.js";
import { openFolder } from "./folder.js";
import { withRetry } from "./retry.js";
import { fetchJson } from "./transport.js";
import type {
  AnchorClient,
  AnchorEvent,
  AnchorSecret,
  CacheEntry,
  ClientOptions,
  ListQuery,
  RequestOptions,
} from "./types.js";

/** A query with every default filled in, as the server receives it and the cache keys it. */
function normalize(q: ListQuery): Required<ListQuery> {
  return {
    project: q.project,
    environment: q.environment,
    path: q.path ?? "/",
    expand: q.expand ?? true,
    includeImports: q.includeImports ?? true,
  };
}

async function fetchFolder(
  cfg: Config,
  q: Required<ListQuery>,
  emit: (event: AnchorEvent) => void,
  signal?: AbortSignal,
): Promise<AnchorSecret[]> {
  const params = new URLSearchParams({
    path: q.path,
    reveal: "true",
    expand: String(q.expand),
    includeImports: String(q.includeImports),
  });
  const url = `${cfg.base}/api/v1/projects/${encodeURIComponent(q.project)}/environments/${encodeURIComponent(q.environment)}/secrets?${params}`;
  const body = (await withRetry(() => fetchJson(cfg, url, signal), cfg.retry, {
    signal,
    emit,
  })) as { secrets?: unknown } | null;
  if (!body || !Array.isArray(body.secrets)) {
    throw new AnchorError(200, "bad_response", "Anchor returned an unexpected response");
  }
  return (body.secrets as WireSecret[]).map(toSecret);
}

const copy = (s: AnchorSecret): AnchorSecret =>
  s.importedFrom ? { ...s, importedFrom: { ...s.importedFrom } } : { ...s };

/** The client's internals that `folder()` builds on. */
export type ClientCore = {
  /** `strict`: a failed fetch rejects instead of returning the cached fallback. */
  loadEntry(q: ListQuery, o?: RequestOptions & { strict?: boolean }): Promise<CacheEntry>;
  ttlMs: number;
  emit: (event: AnchorEvent) => void;
};

export function createClientCore(options: ClientOptions): ClientCore {
  validateOptions(options);
  const emit = (event: AnchorEvent) => emitSafely(options.onEvent, event);
  const policy = cachePolicy(options.cache);
  const cache = policy ? new SecretCache(policy, emit) : undefined;

  return {
    ttlMs: policy ? policy.ttlMs : DEFAULT_TTL_MS,
    emit,
    async loadEntry(q, o = {}) {
      // Configuration errors surface before any cache lookup.
      const cfg = resolveConfig(options);
      const query = normalize(q);
      if (!cache) {
        return { secrets: await fetchFolder(cfg, query, emit, o.signal), fetchedAt: Date.now() };
      }
      // A shared fetch never takes one caller's signal; the cache races it per caller.
      return cache.load(
        cacheKey(cfg.origin, cfg.token, query),
        () => fetchFolder(cfg, query, emit),
        o,
      );
    },
  };
}

export function createAnchorClient(options: ClientOptions = {}): AnchorClient {
  const core = createClientCore(options);
  return {
    async listSecrets(q, o) {
      return (await core.loadEntry(q, o)).secrets.map(copy);
    },
    async loadSecrets(q, o) {
      return decodeAll((await core.loadEntry(q, o)).secrets);
    },
    folder: (q, o) => openFolder(core, q, o),
  };
}

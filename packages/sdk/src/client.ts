import { cacheKey, type Fetched, SecretCache } from "./cache.js";
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
  etag?: string,
): Promise<Fetched> {
  const params = new URLSearchParams({
    path: q.path,
    reveal: "true",
    expand: String(q.expand),
    includeImports: String(q.includeImports),
  });
  const url = `${cfg.base}/api/v1/projects/${encodeURIComponent(q.project)}/environments/${encodeURIComponent(q.environment)}/secrets?${params}`;
  const res = await withRetry(() => fetchJson(cfg, url, signal, etag), cfg.retry, {
    signal,
    emit,
  });
  if (res.status === 304) return "unchanged";
  const body = res.body as { secrets?: unknown } | null;
  if (!body || !Array.isArray(body.secrets)) {
    throw new AnchorError(res.status, "bad_response", "Anchor returned an unexpected response");
  }
  return { secrets: (body.secrets as WireSecret[]).map(toSecret), etag: res.etag };
}

const copy = (s: AnchorSecret): AnchorSecret =>
  s.importedFrom ? { ...s, importedFrom: { ...s.importedFrom } } : { ...s };

/** The client's internals that `folder()` builds on. */
export type ClientCore = {
  /** `strict`: a failed fetch rejects instead of returning the cached fallback. */
  loadEntry(q: ListQuery, o?: RequestOptions & { strict?: boolean }): Promise<CacheEntry>;
  ttlMs: number;
  /** How long past `ttlMs` a folder may serve values after a failed refresh. */
  maxStaleMs: number;
  emit: (event: AnchorEvent) => void;
};

export function createClientCore(options: ClientOptions): ClientCore {
  validateOptions(options);
  const emit = (event: AnchorEvent) => emitSafely(options.onEvent, event);
  const policy = cachePolicy(options.cache);
  const cache = policy ? new SecretCache(policy, emit) : undefined;

  return {
    ttlMs: policy ? policy.ttlMs : DEFAULT_TTL_MS,
    maxStaleMs: policy ? policy.maxStaleMs : Number.POSITIVE_INFINITY,
    emit,
    async loadEntry(q, o = {}) {
      // Configuration errors surface before any cache lookup.
      const cfg = resolveConfig(options);
      const query = normalize(q);
      if (!cache) {
        // No tag is ever sent without a cache, so a 304 here is the server's mistake.
        const fetched = await fetchFolder(cfg, query, emit, o.signal);
        if (fetched === "unchanged") {
          throw new AnchorError(
            304,
            "bad_response",
            "Anchor answered 304 to a request without a tag",
          );
        }
        return { secrets: fetched.secrets, fetchedAt: Date.now() };
      }
      // The cache gives a shared fetch its own signal, aborted when its last caller gives up.
      return cache.load(
        cacheKey(cfg.origin, cfg.token, query),
        (signal, etag) => fetchFolder(cfg, query, emit, signal, etag),
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

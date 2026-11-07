import { createHash } from "node:crypto";
import { AnchorError, abortedError } from "./errors.js";
import type {
  AnchorEvent,
  AnchorSecret,
  CacheEntry,
  CacheOptions,
  CacheStore,
  ListQuery,
} from "./types.js";

export type { CacheEntry, CacheOptions, CacheStore } from "./types.js";
export type CachePolicy = Required<CacheOptions>;

/** A fetch's result: the entry to serve, and the error when it is a stale fallback. */
type Outcome = { entry: CacheEntry; error?: AnchorError };

/** A fetch shared by every caller of one key; aborted when the last of them gives up. */
type Flight = { promise: Promise<Outcome>; controller: AbortController; waiters: number };

export function memoryStore(): CacheStore {
  const entries = new Map<string, CacheEntry>();
  return {
    get: (key) => entries.get(key),
    set: (key, entry) => {
      entries.set(key, entry);
    },
  };
}

/**
 * The cache key of one folder as one token sees it. The token is reduced to a SHA-256
 * fingerprint, so two tokens never share an entry and the key never holds a credential.
 */
export function cacheKey(origin: string, token: string, q: Required<ListQuery>): string {
  const fingerprint = createHash("sha256").update(token).digest("hex").slice(0, 16);
  return JSON.stringify([
    origin,
    fingerprint,
    q.project,
    q.environment,
    q.path,
    q.expand,
    q.includeImports,
  ]);
}

/** Resolves like `promise`, or rejects with `aborted` as soon as `signal` aborts. */
function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortedError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortedError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Serves folders from `store` while they are fresh, coalesces concurrent fetches of one folder,
 * and falls back to the last good entry when a fetch fails. Coalescing and cooldowns are per
 * instance, never in the store.
 */
export class SecretCache {
  private readonly inflight = new Map<string, Flight>();
  /** When the last fetch of a key failed; the stale entry is served without asking for one ttl. */
  private readonly failedAt = new Map<string, number>();

  constructor(
    private readonly policy: CachePolicy,
    private readonly emit: (event: AnchorEvent) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * The folder's entry. With `strict`, a failed fetch rejects instead of falling back, so a
   * caller that asked for new values learns it did not get them.
   */
  async load(
    key: string,
    fetch: (signal: AbortSignal) => Promise<AnchorSecret[]>,
    opts: { fresh?: boolean; signal?: AbortSignal; strict?: boolean } = {},
  ): Promise<CacheEntry> {
    if (opts.signal?.aborted) throw abortedError();
    const entry = await this.read(key);
    if (entry && !opts.fresh && this.servable(key, entry)) return entry;
    const flight = this.inflight.get(key) ?? this.start(key, fetch, entry);
    flight.waiters++;
    let outcome: Outcome;
    try {
      outcome = await untilAborted(flight.promise, opts.signal);
    } catch (error) {
      // A caller that gives up stops the request only when nobody else is waiting for it.
      if (opts.signal?.aborted && --flight.waiters === 0) {
        flight.controller.abort();
        if (this.inflight.get(key) === flight) this.inflight.delete(key);
      }
      throw error;
    }
    if (opts.strict && outcome.error) throw outcome.error;
    return outcome.entry;
  }

  private start(
    key: string,
    fetch: (signal: AbortSignal) => Promise<AnchorSecret[]>,
    stale: CacheEntry | undefined,
  ): Flight {
    const controller = new AbortController();
    const promise: Promise<Outcome> = this.fetch(
      key,
      () => fetch(controller.signal),
      stale,
      controller.signal,
    ).finally(() => {
      if (this.inflight.get(key)?.promise === promise) this.inflight.delete(key);
    });
    const flight: Flight = { promise, controller, waiters: 0 };
    this.inflight.set(key, flight);
    return flight;
  }

  /** A store that fails is a miss: Anchor stays reachable when Redis (or a file) is not. */
  private async read(key: string): Promise<CacheEntry | undefined> {
    try {
      return await this.policy.store.get(key);
    } catch (error) {
      this.emit({ type: "store_failed", operation: "get", error });
      return undefined;
    }
  }

  private async write(key: string, entry: CacheEntry): Promise<void> {
    try {
      await this.policy.store.set(key, entry);
    } catch (error) {
      this.emit({ type: "store_failed", operation: "set", error });
    }
  }

  private servable(key: string, entry: CacheEntry): boolean {
    const now = this.now();
    if (now - entry.fetchedAt < this.policy.ttlMs) return true;
    const failed = this.failedAt.get(key);
    return failed !== undefined && now - failed < this.policy.ttlMs && this.usable(entry, now);
  }

  private usable(entry: CacheEntry, now: number): boolean {
    return now - entry.fetchedAt <= this.policy.ttlMs + this.policy.maxStaleMs;
  }

  private async fetch(
    key: string,
    fetch: () => Promise<AnchorSecret[]>,
    stale: CacheEntry | undefined,
    signal: AbortSignal,
  ): Promise<Outcome> {
    try {
      const entry: CacheEntry = { secrets: await fetch(), fetchedAt: this.now() };
      await this.write(key, entry);
      this.failedAt.delete(key);
      return { entry };
    } catch (error) {
      // Abandoned by every caller: not a failure of Anchor, so no fallback and no cooldown.
      if (signal.aborted) throw error;
      const now = this.now();
      if (!(error instanceof AnchorError) || !stale || !this.usable(stale, now)) throw error;
      this.failedAt.set(key, now);
      const staleForMs = Math.max(0, now - stale.fetchedAt - this.policy.ttlMs);
      this.emit({ type: "refresh_failed", error, staleForMs });
      return { entry: stale, error };
    }
  }
}

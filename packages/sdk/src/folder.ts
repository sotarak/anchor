import type { ClientCore } from "./client.js";
import { decodeAll } from "./decode.js";
import { AnchorError } from "./errors.js";
import type { AnchorFolder, AnchorValue, CacheEntry, ListQuery } from "./types.js";

type Snapshot = { entry: CacheEntry; values: Readonly<Record<string, AnchorValue>> };

/** Freezes plain objects and arrays all the way down: one folder's values are shared by every reader. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const snapshotOf = (entry: CacheEntry): Snapshot => ({
  entry,
  values: deepFreeze(decodeAll(entry.secrets)),
});

export async function openFolder(
  core: ClientCore,
  query: ListQuery,
  options: { signal?: AbortSignal } = {},
): Promise<AnchorFolder> {
  let snapshot = snapshotOf(await core.loadEntry(query, { signal: options.signal }));
  /**
   * When values were last asked for, successfully or not; staleness counts from here. It starts
   * at the entry's fetch time: an entry from a warm shared store may already be old.
   */
  let checkedAt = snapshot.entry.fetchedAt;
  /** Whether the last refresh failed without even a cached fallback (past `maxStaleMs`). */
  let failed = false;
  let pending: Promise<void> | undefined;

  const accept = (entry: CacheEntry) => {
    failed = false;
    // A slow store can answer with an entry older than the one already shown: keep the newer.
    if (entry.fetchedAt < snapshot.entry.fetchedAt) return;
    // Decode once per fetch: a cache hit returns the very entry this snapshot came from.
    if (entry !== snapshot.entry) snapshot = snapshotOf(entry);
  };

  const refreshInBackground = () => {
    pending = core
      .loadEntry(query)
      .then(accept, (error: unknown) => {
        failed = true;
        // Nothing reported this failure yet; never let it reject unobserved.
        if (error instanceof AnchorError) {
          const staleForMs = Math.max(0, Date.now() - snapshot.entry.fetchedAt - core.ttlMs);
          core.emit({ type: "refresh_failed", error, staleForMs });
        }
      })
      .finally(() => {
        checkedAt = Date.now();
        pending = undefined;
      });
  };

  const values = () => {
    if (!pending && Date.now() - checkedAt >= core.ttlMs) refreshInBackground();
    if (failed && Date.now() - snapshot.entry.fetchedAt > core.ttlMs + core.maxStaleMs) {
      throw new AnchorError(
        0,
        "stale",
        "Anchor values are older than ttlMs + maxStaleMs and refreshing them failed",
      );
    }
    return snapshot.values;
  };

  const has = (key: string) => Object.hasOwn(values(), key);

  return {
    get: <T>(key: string) => (has(key) ? snapshot.values[key] : undefined) as T | undefined,
    getOrThrow<T>(key: string) {
      if (!has(key)) throw new Error(`Anchor secret ${key} is not set`);
      return snapshot.values[key] as T;
    },
    has,
    keys: () => Object.keys(values()),
    toObject: values,
    async refresh() {
      try {
        accept(await core.loadEntry(query, { fresh: true, strict: true }));
      } finally {
        checkedAt = Date.now();
      }
    },
  };
}

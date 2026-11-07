import type { ClientCore } from "./client.js";
import { decodeAll } from "./decode.js";
import { AnchorError } from "./errors.js";
import type { AnchorFolder, AnchorValue, CacheEntry, ListQuery } from "./types.js";

type Snapshot = { entry: CacheEntry; values: Readonly<Record<string, AnchorValue>> };

const snapshotOf = (entry: CacheEntry): Snapshot => ({
  entry,
  values: Object.freeze(decodeAll(entry.secrets)),
});

export async function openFolder(
  core: ClientCore,
  query: ListQuery,
  options: { signal?: AbortSignal } = {},
): Promise<AnchorFolder> {
  let snapshot = snapshotOf(await core.loadEntry(query, { signal: options.signal }));
  /** When values were last asked for, successfully or not; staleness counts from here. */
  let checkedAt = Date.now();
  let pending: Promise<void> | undefined;

  const accept = (entry: CacheEntry) => {
    // Decode once per fetch: a cache hit returns the very entry this snapshot came from.
    if (entry !== snapshot.entry) snapshot = snapshotOf(entry);
  };

  const refreshInBackground = () => {
    pending = core
      .loadEntry(query)
      .then(accept, (error: unknown) => {
        // Without a cache nothing reported the failure yet; never let it reject unobserved.
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
      accept(await core.loadEntry(query, { fresh: true, strict: true }));
      checkedAt = Date.now();
    },
  };
}

# SDK refactor: caching and fault tolerance (design)

Status: proposed. Amends `2026-11-07-v0.4.0-sdk-nestjs-design.md`. Both packages are unpublished,
so this lands in 0.4.0 and may change their public API.

## Intent

The owner asked for SDKs that are clean, small and fast, easy to extend later, and that:

1. cache what they fetch, so a read does not call the Anchor server every time;
2. tolerate failures of the server and the network.

Today `@anchor-secrets/sdk` is one 270-line file with no cache: every `listSecrets` /
`loadSecrets` is a request, retried 3 times on network errors, timeouts and 502/503/504.
`@anchor-secrets/nestjs` loads once at startup and freezes the values: they never refresh, and the
app does not start if Anchor is unreachable at that moment.

## Goals

- In-memory cache with a TTL, shared by every read of the same folder in one client.
- Fault tolerance: retry with backoff and jitter, request coalescing, serving the last good values
  when a refresh fails, cancellation, and no failure that crashes a running app.
- An `AnchorFolder` handle with synchronous reads that refreshes in the background; the NestJS
  `AnchorService` becomes a thin wrapper around it.
- Small focused source files, one extension point per concern (cache store, events), no runtime
  dependencies.

## Non-goals

- Writing secrets to disk, or any persistent cache built in. A `CacheStore` interface allows one
  later (an encrypted file, Redis); the docs say a custom store holds plaintext values.
- Push or streaming updates from the server, `setInterval` polling, writing secrets from the SDK,
  browsers and edge runtimes, a `@nestjs/config` loader.

## Anti-goals

- A read that blocks on the network once a folder is loaded.
- A refresh failure that surfaces as an unhandled rejection or stops a running app.
- A token or a value in an error message, an event or a cache key.

## Approaches

1. **Cache inside the client, plus a folder handle (chosen).** One cache serves `listSecrets`,
   `loadSecrets` and `folder()`; Nest and plain Node share the same code.
2. **Cache only in the NestJS module.** Smaller, but plain Node users get nothing and the logic
   would live in the wrong package.
3. **Persistent (disk) cache now.** Lets an app restart while Anchor is down, but puts plaintext
   secrets at rest and needs key management. Deferred behind the `CacheStore` interface.

The owner asked for the plan without picking; approach 1 and memory-only are the author's calls.

## Behavior

### Options (`createAnchorClient`)

| Option | Default | Meaning |
|---|---|---|
| `apiUrl`, `token`, `fetch`, `timeoutMs` | as 0.4.0 (`ANCHOR_API_URL`, `ANCHOR_TOKEN`, global fetch, 10 000 ms per attempt) | unchanged |
| `retry` | `{ attempts: 3, baseDelayMs: 250, maxDelayMs: 5000 }` | `false` turns retries off |
| `cache` | `{ ttlMs: 60_000, maxStaleMs: Infinity, store: memory }` | `false` turns caching off |
| `onEvent` | none | receives `AnchorEvent`s; exceptions it throws are swallowed |

### Retry

- Retried: network errors, per-attempt timeouts, HTTP 429, 502, 503, 504. Nothing else.
- Delay before attempt `n + 1` (n starts at 1): full jitter, `random() * min(maxDelayMs, baseDelayMs * 2^(n-1))`;
  a `Retry-After` header in seconds on 429/503 replaces it, capped at `maxDelayMs`.
- A caller `AbortSignal` stops the request and any wait at once with code `aborted`, not retried.
- `AnchorError` gains `retryable: boolean`.
- Each retry emits `{ type: "retry", attempt, delayMs, error }`.

### Cache

- Key: API origin, a SHA-256 fingerprint of the token (first 16 hex chars), project,
  environment, path, `expand`, `includeImports`. Two tokens never share an entry, even in a shared
  store.
- `listSecrets` / `loadSecrets`: a fresh entry (`age < ttlMs`) is returned without a request. A
  stale or missing entry is fetched; concurrent calls for one key share a single request.
- A failed fetch with an entry no older than `ttlMs + maxStaleMs` returns that entry and emits
  `{ type: "refresh_failed", error, staleForMs }`. The entry is then served without retrying for
  one more `ttlMs` (a cooldown), so a down server is not hit on every read. With no usable entry
  the error is thrown.
- This applies to every error, including 401/403: the process already holds those values, and
  revocation still stops new reads. The event reports it.
- `{ fresh: true }` on a call skips the fresh-entry check and the cooldown, but still falls back
  to a usable entry on failure.
- `CacheStore` = `{ get(key), set(key, entry) }`, each may return a promise; `entry` =
  `{ secrets: AnchorSecret[]; fetchedAt: number }`. Coalescing and cooldowns stay in memory.

### Folder

`client.folder(query, { signal? })` awaits the first load (throws like `loadSecrets`), then returns
`AnchorFolder`: `get`, `getOrThrow`, `has`, `keys`, `toObject` (frozen), all synchronous on the
latest snapshot, and `refresh()`. A read of a snapshot older than `ttlMs` starts one background
refresh and returns the current values; a background failure only emits `refresh_failed`.
`refresh()` fetches with `fresh: true` and rejects on failure, keeping the old snapshot. Values
are decoded once per fetch. No timers stay alive between reads.

### NestJS

- `AnchorModuleOptions` = SDK `ClientOptions` + `ListQuery` + `isGlobal`; cache, retry and
  `onEvent` pass through.
- `AnchorService` wraps an `AnchorFolder`: the same synchronous methods plus `refresh()`; values
  refresh in the background per `ttlMs`. Startup still fails if the first load fails.
- `ANCHOR_SECRETS` (a startup snapshot that would go stale) is removed; `toObject()` replaces it.
- The `loadAnchorEnv` guide imports `AppModule` inside `bootstrap()`, after the env is loaded,
  because `ConfigModule.forRoot` reads and validates `process.env` when `app.module` is imported
  (verified on `@nestjs/config` 12.1.1: validation fails with the import at the top).

### Budgets

SDK `dist/index.js` stays under 12 KB (5.5 KB today); no runtime dependencies; publint and attw
green on node10, node16 CJS/ESM and bundler.

## Left to the builder

File boundaries inside each package, internal names, and test helpers.

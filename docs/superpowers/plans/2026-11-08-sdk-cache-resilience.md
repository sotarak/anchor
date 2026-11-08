# SDK Cache and Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `@anchor-secrets/sdk` and `@anchor-secrets/nestjs` into small focused modules
with an in-memory TTL cache, retry with jittered backoff, request coalescing, stale-if-error and a
background-refreshing `AnchorFolder`.

**Architecture:** The SDK splits into `types`, `errors`, `config`, `transport` (one HTTP attempt),
`retry` (policy), `cache` (TTL + coalescing + stale fallback over a pluggable `CacheStore`),
`decode`, `folder` and `client`; `index.ts` only re-exports. NestJS's `AnchorService` wraps an
SDK `AnchorFolder`. A shared build helper emits per-file `.d.ts` / `.d.cts` twins for both
packages.

**Tech Stack:** TypeScript, esbuild, vitest (fake timers), Node ≥ 20 WebCrypto and fetch, NestJS
10–12.

**Spec:** `docs/superpowers/specs/2026-11-08-sdk-cache-resilience-design.md` (amends
`docs/superpowers/specs/2026-11-07-v0.4.0-sdk-nestjs-design.md`).

## Global Constraints

- Branch: `feat/v0.4.0` (both packages are unpublished; this ships in 0.4.0).
- SDK: no runtime dependencies; `engines.node` `>=20`; `@anchor/shared` stays bundled and never
  appears in a published declaration file.
- SDK `dist/index.js` under 20 KB (raised from 12 KB by the 0.4.0 release and the 0.5.0 spec; see `bundle.test.ts`).
- `pnpm --filter <pkg> check:package` (publint + attw) green for both packages.
- Never put a token or a secret value in an error message, an event, a cache key or a log.
- Defaults: `timeoutMs` 10 000; `retry` `{ attempts: 3, baseDelayMs: 250, maxDelayMs: 5000 }`;
  `cache` `{ ttlMs: 60_000, maxStaleMs: Infinity }`.
- Retried: network, timeout, HTTP 429, 502, 503, 504. Delay: full jitter
  `random() * min(maxDelayMs, baseDelayMs * 2^(n-1))`; `Retry-After` (seconds) on 429/503 wins,
  capped at `maxDelayMs`.
- No `setInterval`, no timer left alive between reads.
- Code, comments, commits in English; `git commit -s`, Conventional Commits, trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Fifty concurrent first reads of one folder (Nest providers plus early requests) → one HTTP
   request. Pinned in Task 3.
2. Server down for longer than `ttlMs` after a warm load → reads keep returning the old values, at
   most one request per `ttlMs`, no unhandled rejection. Pinned in Tasks 3 and 5.
3. Token revoked (401) during a refresh → old values served, `refresh_failed` emitted; a 401 on
   the first load throws. Pinned in Task 3.
4. Caller aborts during a retry wait → rejects at once with code `aborted`, no further request,
   no timer left. Pinned in Task 2.
5. Two clients with different tokens sharing one custom store → neither sees the other's entry.
   Pinned in Task 3.

---

### Task 1: Split the SDK into modules, with a shared declaration build

No behavior change: every existing SDK test passes unchanged.

**Files:**
- Create: `scripts/dual-declarations.mjs`, `scripts/dual-declarations.test.mjs`
- Create: `packages/sdk/src/{types,errors,config,transport,decode,client}.ts`
- Modify: `packages/sdk/src/index.ts` (re-exports only), `packages/sdk/build.mjs`,
  `packages/nestjs/build.mjs`, `packages/sdk/test/unit/package.test.ts`

**Interfaces:**
- Produces: `emitDualDeclarations({ typesDir: URL, distDir: URL, forbid?: string[] }): Promise<string[]>`
  — copies each `*.d.ts` in `typesDir` to `distDir`, writes a `.d.cts` twin whose relative
  `./x.js` / `../x.js` specifiers become `.cjs`, throws `Error("<file> imports <specifier>")` if
  any declaration imports a specifier starting with an entry of `forbid`, returns written names.
- Produces (internal, used by later tasks): `resolveConfig(opts: ClientOptions): Config` in
  `config.ts`; `toSecret(w: WireSecret): AnchorSecret` and `decodeAll(s: AnchorSecret[]): Record<string, AnchorValue>`
  (first key wins) in `decode.ts`; `AnchorError` in `errors.ts`; public types in `types.ts`.

- [ ] **Step 1: Write the failing helper test** (`node:test`, temp dirs)

```js
test("writes .d.cts twins with relative imports pointing at .cjs", async () => {
  // typesDir has a.d.ts: `export * from "./b.js"; import type { X } from "../c.js";`
  const names = await emitDualDeclarations({ typesDir, distDir });
  assert.deepEqual(names.sort(), ["a.d.cts", "a.d.ts"]);
  assert.match(await read(distDir, "a.d.cts"), /"\.\/b\.cjs"/);
  assert.match(await read(distDir, "a.d.cts"), /"\.\.\/c\.cjs"/);
  assert.match(await read(distDir, "a.d.ts"), /"\.\/b\.js"/);
});
test("leaves package specifiers alone", ...); // `from "@nestjs/common"` unchanged in .d.cts
test("refuses a forbidden import", async () => {
  // a.d.ts: `import type { V } from "@anchor/shared/value-decode";`
  await assert.rejects(emitDualDeclarations({ typesDir, distDir, forbid: ["@anchor/shared"] }),
    /a\.d\.ts imports @anchor\/shared\/value-decode/);
});
```

- [ ] **Step 2: Run it** — `node --test scripts/dual-declarations.test.mjs` → FAIL (module not found).
- [ ] **Step 3: Implement `scripts/dual-declarations.mjs`.** Same regex as today's nestjs build.
- [ ] **Step 4: Run it** → PASS. `pnpm test:scripts` → all pass.
- [ ] **Step 5: Add to `package.test.ts`:** `it("emits one declaration pair per source module")` —
  after `node build.mjs`, `dist/client.d.ts` and `dist/client.d.cts` exist, and
  `dist/index.d.cts` contains `"./client.cjs"`. Run → FAIL (one bundled file today).
- [ ] **Step 6: Split `src/index.ts`** into the files above (move code, no edits beyond imports);
  `index.ts` re-exports the public names it exports today. Switch both `build.mjs` files to
  `emitDualDeclarations` (SDK with `forbid: ["@anchor/shared"]`), dropping the self-contained
  check.
- [ ] **Step 7: Verify** — `pnpm --filter @anchor-secrets/sdk test`, `… build`, `… check:package`,
  `pnpm --filter @anchor-secrets/nestjs build && pnpm --filter @anchor-secrets/nestjs check:package`
  → all green, existing tests unchanged.
- [ ] **Step 8: Commit** `refactor(sdk): split the client into modules`.

### Task 2: Retry policy, cancellation and `retryable`

**Files:**
- Create: `packages/sdk/src/retry.ts`, `packages/sdk/test/unit/retry.test.ts`
- Modify: `packages/sdk/src/transport.ts`, `errors.ts`, `config.ts`, `client.ts`,
  `test/unit/client.test.ts` (retry timings)

**Interfaces:**
- Consumes: `AnchorError`, `Config` (Task 1).
- Produces:
  - `type RetryOptions = { attempts?: number; baseDelayMs?: number; maxDelayMs?: number }`;
    `ClientOptions.retry?: RetryOptions | false`; `ClientOptions.onEvent?: (e: AnchorEvent) => void`.
  - `type AnchorEvent = { type: "retry"; attempt: number; delayMs: number; error: AnchorError } | { type: "refresh_failed"; error: AnchorError; staleForMs: number }`.
  - `AnchorError` constructor options gain `retryable?: boolean` and `retryAfterMs?: number`;
    public `readonly retryable: boolean` (default `false`).
  - `fetchJson(cfg: Config, url: string, signal?: AbortSignal): Promise<unknown>` — one attempt;
    throws `AnchorError` with `retryable` set per the Global Constraints list.
  - `withRetry<T>(run: () => Promise<T>, policy: Required<RetryOptions> | false, opts: { signal?: AbortSignal; emit: (e: AnchorEvent) => void }): Promise<T>`.
  - `emitSafely(onEvent, event)` in `config.ts`: calls the hook, swallows what it throws.

- [ ] **Step 1: Write the failing tests** (fake timers, `vi.spyOn(Math, "random").mockReturnValue(0.5)`)

```ts
it("waits full-jitter backoff: 125 ms then 250 ms with random 0.5", ...); // 3 calls; gaps 125, 250
it("caps the backoff at maxDelayMs", ...);       // { attempts: 5, baseDelayMs: 4000, maxDelayMs: 5000 }: 3rd gap = 2500
it("honors Retry-After on 429, capped at maxDelayMs", ...); // header "2" → gap 2000; header "60" → 5000
it("does not retry 400, 401, 403, 404 or 500", ...);         // each: 1 call, error.retryable === false
it("retries 429, 502, 503, 504, network and timeout", ...);  // each: error.retryable === true
it("stops at once when the caller aborts during a wait", async () => {
  // 503 then abort after 50 ms → rejects AnchorError code "aborted"; 1 call; vi.getTimerCount() === 0
});
it("aborts an in-flight request when the caller aborts", ...); // fetch sees signal.aborted === true
it("retry: false makes one attempt", ...);
it("emits a retry event per wait without the token", ...);     // JSON.stringify(event) lacks TOKEN
it("an onEvent hook that throws does not break the request", ...);
```

- [ ] **Step 2: Run** `pnpm --filter @anchor-secrets/sdk exec vitest run test/unit/retry.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Link the caller signal to the per-attempt controller with an
  `abort` listener (no `AbortSignal.any`, Node 20.0 lacks it); remove listeners and timers in
  `finally`. The wait is an abortable sleep. Update the two existing timing tests in
  `client.test.ts` to the new delays.
- [ ] **Step 4: Run** the SDK suite → PASS.
- [ ] **Step 5: Commit** `feat(sdk): jittered retries, Retry-After and cancellation`.

### Task 3: The secret cache

**Files:**
- Create: `packages/sdk/src/cache.ts`, `packages/sdk/test/unit/cache.test.ts`

**Interfaces:**
- Consumes: `AnchorSecret`, `AnchorError`, `AnchorEvent` (Tasks 1–2).
- Produces:
  - `type CacheEntry = { secrets: AnchorSecret[]; fetchedAt: number }`
  - `interface CacheStore { get(key: string): CacheEntry | undefined | Promise<CacheEntry | undefined>; set(key: string, entry: CacheEntry): void | Promise<void> }`
  - `type CacheOptions = { ttlMs?: number; maxStaleMs?: number; store?: CacheStore }`
  - `memoryStore(): CacheStore`
  - `cacheKey(origin: string, token: string, q: Required<ListQuery>): Promise<string>` — token
    reduced to the first 16 hex chars of its SHA-256 (`crypto.subtle`).
  - `class SecretCache { constructor(opts: Required<CacheOptions>, emit: (e: AnchorEvent) => void, now?: () => number); load(key: string, fetch: () => Promise<AnchorSecret[]>, opts?: { fresh?: boolean }): Promise<CacheEntry> }`

- [ ] **Step 1: Write the failing tests** (a counting `fetch` stub, injected `now`)

```ts
it("serves a fresh entry without fetching", ...);            // 2 loads within ttl → 1 fetch
it("refetches after ttl", ...);                              // now += ttl → 2 fetches
it("coalesces 50 concurrent loads into one fetch", ...);     // Promise.all of 50 → 1 fetch, same entry
it("serves the stale entry when a refresh fails and emits refresh_failed", ...);
  // warm; now += ttl + 1000; fetch rejects AnchorError(503) → entry returned;
  // event { type: "refresh_failed", staleForMs: 1000 }
it("keeps serving stale on 401 during a refresh", ...);      // same with AnchorError(401, "unauthenticated")
it("throws when there is no entry to fall back on", ...);    // first load rejects 401 → rejects 401
it("waits one ttl before retrying after a failed refresh", ...);
  // fail at t; load at t + ttl/2 → no fetch; load at t + ttl → fetch
it("fresh: true skips the fresh check and the cooldown but still falls back", ...);
it("drops entries older than ttl + maxStaleMs", ...);        // maxStaleMs 5000; fail at age ttl + 6000 → rejects
it("never shares entries between tokens", async () => {
  const k1 = await cacheKey(API, "anc_st_one", q), k2 = await cacheKey(API, "anc_st_two", q);
  expect(k1).not.toBe(k2); expect(k1).not.toContain("anc_st_one");
});
it("works with an async store", ...);                         // store whose get/set return promises
```

- [ ] **Step 2: Run** `… vitest run test/unit/cache.test.ts` → FAIL.
- [ ] **Step 3: Implement `cache.ts`.** In-flight promises and cooldown timestamps live in `Map`s
  on the instance, not in the store; delete the in-flight entry in `finally`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(sdk): TTL cache with coalescing and stale fallback`.

### Task 4: Wire the cache into the client

**Files:**
- Modify: `packages/sdk/src/{types,config,client,index}.ts`, `test/unit/client.test.ts`,
  `test/unit/bundle.test.ts`

**Interfaces:**
- Consumes: `SecretCache`, `cacheKey`, `memoryStore`, `withRetry`, `fetchJson` (Tasks 2–3).
- Produces:
  - `ClientOptions.cache?: CacheOptions | false`
  - `type RequestOptions = { signal?: AbortSignal; fresh?: boolean }`
  - `AnchorClient.listSecrets(q: ListQuery, o?: RequestOptions): Promise<AnchorSecret[]>`
  - `AnchorClient.loadSecrets(q: ListQuery, o?: RequestOptions): Promise<Record<string, AnchorValue>>`
  - Internal `client.ts` helper `loadEntry(q, o): Promise<CacheEntry>` reused by Task 5.
  - `index.ts` exports `memoryStore` and the types `CacheStore`, `CacheEntry`, `CacheOptions`,
    `RetryOptions`, `RequestOptions`, `AnchorEvent`.

- [ ] **Step 1: Write the failing tests**

```ts
it("a second loadSecrets within ttl makes no request", ...);   // 1 call
it("cache: false requests every time", ...);                   // 2 calls
it("fresh: true requests even within ttl", ...);               // 2 calls
it("different folders are cached separately", ...);            // /api and /shared → 2 calls
it("returns copies, so callers cannot change the cache", ...); // mutate result[0].value; next call unchanged
it("a config error is thrown before any cache lookup", ...);   // no apiUrl → code config, store.get not called
```

  In `bundle.test.ts`: `it("keeps dist/index.js under 12 KB")` — build with the package's esbuild
  options and assert `outputFiles[0].contents.byteLength < 12 * 1024`.
- [ ] **Step 2: Run** the SDK suite → the new tests FAIL.
- [ ] **Step 3: Implement.** `resolveConfig` normalizes `retry` and `cache` with the defaults from
  Global Constraints; the cache key is computed once per query shape. `listSecrets` returns
  shallow copies of the entry's secrets.
- [ ] **Step 4: Run** the SDK suite and `… check:package` → PASS.
- [ ] **Step 5: Commit** `feat(sdk): cache reads in the client`.

### Task 5: `AnchorFolder`

**Files:**
- Create: `packages/sdk/src/folder.ts`, `packages/sdk/test/unit/folder.test.ts`
- Modify: `packages/sdk/src/{client,index}.ts`

**Interfaces:**
- Consumes: `loadEntry`, `decodeAll`, `emitSafely` (Tasks 1, 2, 4).
- Produces:
  - `interface AnchorFolder { get<T = AnchorValue>(key: string): T | undefined; getOrThrow<T = AnchorValue>(key: string): T; has(key: string): boolean; keys(): string[]; toObject(): Readonly<Record<string, AnchorValue>>; refresh(): Promise<void> }`
  - `AnchorClient.folder(q: ListQuery, o?: { signal?: AbortSignal }): Promise<AnchorFolder>`
  - `getOrThrow` on a missing key throws `Error("Anchor secret <KEY> is not set")`.

- [ ] **Step 1: Write the failing tests** (fake timers)

```ts
it("loads once and reads synchronously", ...);           // get/has/keys/toObject; 1 call
it("a read after ttl returns current values and refreshes in the background", ...);
  // advance ttl; get("A") → old value, 2 calls started; await flush; get("A") → new value
it("several stale reads start one refresh", ...);          // 10 reads after ttl → 2 calls total
it("a failed background refresh keeps values and only emits", ...);
  // 503s after warm load; reads keep old values; onEvent got refresh_failed;
  // process "unhandledRejection" listener never called
it("refresh() rejects on failure and keeps the old values", ...);
it("leaves no timers between reads", ...);                  // vi.getTimerCount() === 0 after load and after a refresh
it("toObject() is frozen and decoded once per fetch", ...); // Object.isFrozen; same reference until the next fetch
it("folder() rejects when the first load fails", ...);      // 401 → AnchorError 401
```

- [ ] **Step 2: Run** `… vitest run test/unit/folder.test.ts` → FAIL.
- [ ] **Step 3: Implement.** The snapshot holds the decoded frozen record and its `fetchedAt`; a
  stale read calls `loadEntry` once (guard with the pending promise) and `.catch`es into
  `onEvent`.
- [ ] **Step 4: Run** the SDK suite → PASS.
- [ ] **Step 5: Commit** `feat(sdk): AnchorFolder with background refresh`.

### Task 6: NestJS on top of `AnchorFolder`

**Files:**
- Modify: `packages/nestjs/src/{anchor.module,anchor.service,tokens,index}.ts`,
  `packages/nestjs/test/unit/anchor.module.test.ts`

**Interfaces:**
- Consumes: `AnchorClient.folder`, `AnchorFolder`, `ClientOptions` (Tasks 4–5).
- Produces: `class AnchorService implements AnchorFolder` (constructor takes an `AnchorFolder`,
  every method delegates). `ANCHOR_SECRETS` is removed from `tokens.ts` and the exports;
  `ANCHOR_OPTIONS` stays.

- [ ] **Step 1: Write the failing tests**

```ts
it("refreshes values in the background after ttl", ...);  // forRoot({ ..., cache: { ttlMs: 1000 } }); 2nd value after advance + flush
it("refresh() fetches now", ...);
it("passes retry and onEvent through to the SDK", ...);    // 503 then 200 with retry { baseDelayMs: 1 }; onEvent got retry
it("still fails startup when the first load fails", ...);  // existing behavior kept
it("no longer exports ANCHOR_SECRETS", ...);               // expect("ANCHOR_SECRETS" in exports).toBe(false)
```

  Remove the old `ANCHOR_SECRETS` assertions.
- [ ] **Step 2: Run** `pnpm --filter @anchor-secrets/nestjs test` → FAIL.
- [ ] **Step 3: Implement.** The `AnchorService` provider is
  `useFactory: async (o) => new AnchorService(await createAnchorClient(o).folder(o))`.
- [ ] **Step 4: Run** the nestjs suite, `… build`, `… check:package` → PASS.
- [ ] **Step 5: Commit** `refactor(nestjs): AnchorService wraps an AnchorFolder`.

### Task 7: Docs, changelog and the `ConfigService` example

**Files:**
- Modify: `apps/docs/src/content/docs/guides/sdk.md`, `packages/sdk/README.md`,
  `packages/nestjs/README.md`, `CHANGELOG.md`,
  `docs/superpowers/specs/2026-11-07-v0.4.0-sdk-nestjs-design.md` (one line pointing at the
  amendment), `apps/web/test/unit/deploy/repository.test.ts`

- [ ] **Step 1: Write the failing repository tests**

```ts
it("the SDK guide documents caching, retries, folders and events", () => {
  const sdk = read("apps/docs/src/content/docs/guides/sdk.md");
  for (const s of ["ttlMs", "maxStaleMs", "cache: false", "retry", "client.folder(", "refresh_failed", "CacheStore"])
    expect(sdk).toContain(s);
  expect(sdk).not.toContain("ANCHOR_SECRETS");
});
it("loadAnchorEnv examples import AppModule after the env is loaded", () => {
  for (const file of ["apps/docs/src/content/docs/guides/sdk.md", "packages/nestjs/README.md"]) {
    const doc = read(file);
    const example = doc.slice(doc.indexOf("// main.ts"), doc.indexOf("```", doc.indexOf("// main.ts")));
    expect(example, file).not.toMatch(/^import \{ AppModule \}/m);
    expect(example.indexOf("await loadAnchorEnv("), file)
      .toBeLessThan(example.indexOf('await import("./app.module")'));
  }
});
```

  The existing bootstrap test stays.
- [ ] **Step 2: Run** `pnpm --filter @anchor/web exec vitest run test/unit/deploy/repository.test.ts` → FAIL.
- [ ] **Step 3: Write the docs.**
  - Guide: a "Caching" section (defaults, `cache: false`, `fresh`, a custom `CacheStore` holds
    plaintext values, so encrypt it), a "When Anchor is down" section (retries, stale values,
    `refresh_failed`, a first load still fails), folders, events, and the `ConfigService` note
    (`ConfigModule.forRoot` reads `process.env` when `app.module` is imported).
  - Both READMEs follow the guide.
  - `CHANGELOG.md` 0.4.0 SDK bullet mentions caching and fault tolerance.
- [ ] **Step 4: Run** the repository tests → PASS; then the full gate: `pnpm typecheck && pnpm test && pnpm lint && pnpm test:scripts`,
  and `check:package` for both packages → all green.
- [ ] **Step 5: Commit** `docs(sdk): caching, fault tolerance and folders`.

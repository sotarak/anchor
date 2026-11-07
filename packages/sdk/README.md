# @anchor-secrets/sdk

A Node client for [Anchor](https://sotarak.github.io/anchor/), a self-hosted secrets and
configuration manager that runs on your own Cloudflare account. Use it to read a folder of
secrets from your service, without wrapping the process in `anchor run`: values are cached,
refreshed in the background, and kept when Anchor is unreachable. For NestJS, use
[`@anchor-secrets/nestjs`](https://www.npmjs.com/package/@anchor-secrets/nestjs), which is built on
this package.

## Install

```sh
npm install @anchor-secrets/sdk
```

Requires Node.js 20 or later. ESM and CommonJS, with types; no runtime dependencies.

## Use

Create a `read` service token for the environment and folder (dashboard → project → Service
tokens, or `anchor tokens create`), and give the service two variables:

```sh
ANCHOR_API_URL=https://anchor.example.com
ANCHOR_TOKEN=anc_st_...
```

```ts
import { createAnchorClient } from "@anchor-secrets/sdk";

const anchor = createAnchorClient(); // reads ANCHOR_API_URL and ANCHOR_TOKEN
const folder = await anchor.folder({ project: "shop", environment: "prod", path: "/api" });

folder.get<string>("DATABASE_URL"); // synchronous, never waits for the network
```

- `client.folder(query)` loads once and returns an `AnchorFolder`: `get`, `getOrThrow`, `has`,
  `keys`, `toObject` (frozen) and `refresh()`. A read of values older than the cache ttl returns
  them at once and starts one background refresh.
- `loadSecrets(query)` returns `{ KEY: value }` with typed values decoded: `number` and `boolean`
  become numbers and booleans, `json` and `list` are parsed, `string` and `pem` stay strings.
  `listSecrets(query)` returns the secrets with their metadata (`key`, `path`, `type`,
  `sensitive`, `version`, `value` as a string, `importedFrom`). Both take `{ signal, fresh }`.
- `query` is `{ project, environment, path?, expand?, includeImports? }`. `path` defaults to `/`;
  `${...}` references are expanded and folder imports are included unless you pass `false`.

## Options

```ts
createAnchorClient({
  apiUrl, // default ANCHOR_API_URL
  token, // default ANCHOR_TOKEN
  timeoutMs: 10_000, // per attempt
  retry: { attempts: 3, baseDelayMs: 250, maxDelayMs: 5_000 }, // or false
  cache: { ttlMs: 60_000, maxStaleMs: Infinity }, // or false; store: a custom CacheStore
  onEvent: (event) => {}, // "retry" and "refresh_failed"
  fetch, // replaces the global fetch
});
```

- **Cache:** in memory, per client, keyed by a fingerprint of the token (never the token).
  Concurrent reads of one folder share a request. A custom `CacheStore` receives plaintext
  values: encrypt them.
- **Failures:** network errors, timeouts and HTTP 429/502/503/504 are retried with jittered
  backoff, honoring `Retry-After`. When a refresh fails, the last good values are served (up to
  `maxStaleMs` past the ttl), `refresh_failed` is emitted, and Anchor is not asked again for one
  ttl. The first load has nothing to fall back on and throws.

## Errors

Every failure is an `AnchorError` with `status` (0 when there was no response), `code` and
`retryable`: `config` (URL or token missing, before any request), `network`, `timeout`,
`aborted`, or the server's error code such as `unauthenticated`, `forbidden` or `not_found`.
Messages and events never contain tokens or values.

Every value the client reads is recorded in the project's audit log under the token's name.

## License

Apache-2.0

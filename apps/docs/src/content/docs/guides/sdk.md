---
title: Load secrets in Node and NestJS
description: Read configuration from Anchor when a Node or NestJS service starts, with the SDK packages.
sidebar:
  order: 8
---

Two npm packages let a service read its configuration from Anchor, without wrapping the process
in `anchor run`:

- `@anchor-secrets/sdk`: a small Node client (Node 20 or later, no runtime dependencies).
- `@anchor-secrets/nestjs`: a NestJS module built on it (NestJS 10, 11 or 12).

Both cache what they fetch, so reading a value does not call Anchor each time. A read of values
older than the cache ttl (one minute by default) starts one background refresh; there is no timer,
so an idle service asks nothing. A refresh is a conditional request: when nothing changed, Anchor
answers `304` and the service keeps the values it has. When Anchor is unreachable, a running
service keeps its values too. They only read; writing secrets stays with the CLI and the
dashboard.

## Give the service a token

Create a `read` service token scoped to the environment (and, if you like, the folder) the service
needs:

```sh
anchor tokens create --name zepo-engine-prod --scope prod:/shared --permission read --project zepo
```

Give the service two variables, through your platform's secret settings:

```sh
ANCHOR_API_URL=https://anchor.example.com
ANCHOR_TOKEN=anc_st_...
```

A token expires after 90 days by default. For a long-running server you can create one with
`--expires-in never`; see [Tokens without an expiry](/anchor/guides/ci/#tokens-without-an-expiry).
Every request that returns values is in the project's audit log under the token's name. A refresh
answered with `304` returns no values and writes no audit row, so an unchanged folder adds nothing
to the log.

## NestJS

```sh
npm install @anchor-secrets/nestjs
```

```ts
// app.module.ts
import { Module } from "@nestjs/common";
import { AnchorModule } from "@anchor-secrets/nestjs";

@Module({
  imports: [AnchorModule.forRoot({ project: "zepo", environment: "prod", path: "/shared" })],
})
export class AppModule {}
```

```ts
// database.service.ts
import { Injectable } from "@nestjs/common";
import { AnchorService } from "@anchor-secrets/nestjs";

@Injectable()
export class DatabaseService {
  constructor(private readonly anchor: AnchorService) {}

  connectionString(): string {
    return this.anchor.getOrThrow<string>("DATABASE_URL");
  }

  poolSize(): number {
    return this.anchor.get<number>("DB_POOL_SIZE") ?? 10;
  }
}
```

- The secrets load while the application initializes. If Anchor cannot be reached or the token
  is refused, startup fails with an `AnchorError`: the service never starts without its
  configuration.
- `AnchorService` reads synchronously: `get(key)` (or `undefined`), `getOrThrow(key)` (throws
  `Anchor secret KEY is not set`), `has(key)`, `keys()` and `toObject()` (every value, frozen all the way down: nested
  `json` objects and `list` arrays cannot be changed).
  `refresh()` fetches now.
- Values refresh in the background: a read of values older than the cache `ttlMs` (default one
  minute) returns them at once and starts one refresh. Read a value where you use it to see
  changes; a value copied into a connection pool at startup stays as it was.
- Values are decoded by their type: a `number` secret is a number, a `boolean` a boolean, `json`
  and `list` are parsed; `string` and `pem` stay strings.
- The module is global, so feature modules can inject `AnchorService` without importing it. Pass
  `isGlobal: false` to change that. Every client option below (`cache`, `retry`, `onEvent`, ...)
  can be passed to `forRoot`.

To take the options from other providers, for example the environment name from `ConfigService`:

```ts
AnchorModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    project: "zepo",
    environment: config.getOrThrow("APP_ENV"),
    path: "/shared",
  }),
});
```

### Apps that read process.env

If the app already reads its configuration from `process.env`, for example through
`@nestjs/config`, copy the secrets into the environment before Nest starts, and import the app
module only after that:

```ts
// main.ts
import { NestFactory } from "@nestjs/core";
import { loadAnchorEnv } from "@anchor-secrets/nestjs";

async function bootstrap() {
  await loadAnchorEnv({ project: "zepo", environment: "prod", path: "/shared" });
  // Imported here: ConfigModule.forRoot reads and validates process.env when app.module loads.
  const { AppModule } = await import("./app.module");
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
void bootstrap();
```

`loadAnchorEnv` writes each value as the string Anchor stores, so `ConfigService.get` returns
strings (let your validation schema convert them). A variable that is already set wins, so a
local override still works; pass `override: true` to let Anchor win. It writes nothing unless the
whole folder loads, and logs nothing. `process.env` is written once: these values do not refresh.

## Any Node service

```sh
npm install @anchor-secrets/sdk
```

```ts
import { createAnchorClient } from "@anchor-secrets/sdk";

const anchor = createAnchorClient(); // ANCHOR_API_URL and ANCHOR_TOKEN
const folder = await anchor.folder({ project: "zepo", environment: "prod", path: "/shared" });

folder.get<string>("DATABASE_URL"); // "postgres://..."
folder.get<number>("DB_POOL_SIZE"); // 20
```

- `client.folder(query)` loads the folder once and returns an `AnchorFolder` with the same
  synchronous methods as `AnchorService`, refreshing in the background.
- `loadSecrets(query)` returns `{ KEY: value }` with values decoded; `listSecrets(query)` returns
  each secret with its `key`, `path`, `type`, `sensitive`, `version`, `value` (a string) and
  `importedFrom`. Both are served from the cache while it is fresh.
- `query` is `{ project, environment, path?, expand?, includeImports? }`. `${...}` references are
  expanded and the folder's imports are included, as with `anchor run`, unless you pass `false`.
- `listSecrets` and `loadSecrets` also take `{ signal, fresh }`: an `AbortSignal` cancels the call
  (code `aborted`), and `fresh: true` asks Anchor even when the cached folder is fresh.

## Options

```ts
createAnchorClient({
  apiUrl, // default ANCHOR_API_URL
  token, // default ANCHOR_TOKEN
  timeoutMs: 10_000, // per attempt
  retry: { attempts: 3, baseDelayMs: 250, maxDelayMs: 5_000 }, // or false
  cache: { ttlMs: 60_000, maxStaleMs: Infinity }, // or false
  onEvent: (event) => {},
  fetch, // replaces the global fetch, for proxies and tests
});
```

Options win over the environment variables.

## Caching

Each client keeps the folders it fetched in memory, keyed by server, token, project, environment,
folder and the `expand` / `includeImports` flags. A folder younger than `ttlMs` is served without
a request, and reads that arrive while a fetch is under way share it. `cache: false` asks Anchor
on every call.

Anchor tags every folder it sends with an `ETag`. When a cached folder is older than `ttlMs` (or
you pass `fresh: true`), the client sends that tag back as `If-None-Match`. If nothing in the
folder changed, Anchor answers `304 Not Modified` with no body: the client keeps the values it
has, renews their age, and decodes nothing again. With `cache: false` the client never sends
`If-None-Match`, so every call returns the full folder (and is audited). Folders cached by SDK
0.4.0 carry no tag; their first refresh is a plain request.

`loadSecrets` returns fresh objects you may change on every call; an `AnchorFolder` (and
`AnchorService`) shares one frozen copy between all readers.

Nothing is written to disk. To keep folders elsewhere, for example in Redis, pass a `CacheStore`:

```ts
import type { CacheStore } from "@anchor-secrets/sdk";

const store: CacheStore = {
  get: async (key) => decrypt(await redis.get(key)),
  set: async (key, entry) => void (await redis.set(key, encrypt(entry))),
};
createAnchorClient({ cache: { store } });
```

A store receives plaintext secret values: encrypt them, and never share one store between
services that should not read each other's secrets. A store that throws never fails a read: the
client asks Anchor instead, or keeps the fetched values without storing them, and reports
`store_failed`. Cache keys contain a SHA-256 fingerprint of
the token, never the token itself.

## When Anchor is down

- Network errors, timeouts and HTTP 429, 502, 503 and 504 are retried, by default up to 3
  attempts in total, waiting a random time up to 250 ms, then up to 500 ms (doubling, capped at
  `maxDelayMs`). A `Retry-After` header is honored, up to `maxDelayMs`. Other errors fail at once.
- When a refresh fails and the client has the folder from before, it serves those values and
  reports `refresh_failed`. It then waits one `ttlMs` before asking Anchor again. This holds for a
  revoked token (`401`) too: the service keeps what it had, and new reads stop.
- `maxStaleMs` limits how long past `ttlMs` old values may be served; by default there is no
  limit. Past it, `listSecrets` and `loadSecrets` throw the refresh error, and an `AnchorFolder`
  or `AnchorService` read throws an `AnchorError` with code `stale` until Anchor answers again.
  Set it only if serving old values is worse for you than failing.
- The first load has nothing to fall back on: it fails, and a NestJS app does not start.
- Without `maxStaleMs`, an `AnchorFolder` or `AnchorService` read never fails because of the
  network; a background refresh that fails only reports `refresh_failed`.

## Events

`onEvent` receives what the client does about failures, for your logs or metrics. Events never
contain a token or a value, and an exception thrown by the hook is ignored.

```ts
createAnchorClient({
  onEvent: (event) => {
    if (event.type === "retry") logger.warn(`Anchor retry ${event.attempt}: ${event.error.code}`);
    if (event.type === "refresh_failed") {
      logger.error(`Anchor unreachable, serving values ${event.staleForMs} ms past their ttl`);
    }
    if (event.type === "store_failed") logger.error(`Cache store ${event.operation} failed`);
  },
});
```

## Errors

Every failure is an `AnchorError` with a `status` (0 when there was no response), a `code` and
`retryable`:

| `code` | Meaning |
|---|---|
| `config` | `ANCHOR_API_URL` or `ANCHOR_TOKEN` is missing; nothing was sent |
| `network`, `timeout` | Anchor could not be reached, or did not answer within `timeoutMs` |
| `aborted` | The caller's `AbortSignal` cancelled the call |
| `stale` | A folder's values are older than `ttlMs + maxStaleMs` and refreshing them failed |
| `unauthenticated` | The token is wrong, expired or revoked |
| `forbidden` | The token's scopes do not cover this environment or folder |
| `not_found` | The project, environment or folder does not exist |

Error messages never contain the token or a value.

# @anchor-secrets/nestjs

Load configuration and secrets from [Anchor](https://sotarak.github.io/anchor/), a self-hosted
secrets manager on your own Cloudflare account, into a NestJS application, cached and refreshed in
the background. Built on
[`@anchor-secrets/sdk`](https://www.npmjs.com/package/@anchor-secrets/sdk).

## Install

```sh
npm install @anchor-secrets/nestjs
```

Requires Node.js 20 or later and NestJS 10, 11 or 12. ESM and CommonJS, with types. (NestJS 12
is ESM-only; a CommonJS app on it needs a Node version with `require(esm)`, 20.19 or 22.12 and
later.)

Create a `read` service token for the environment and folder, and give the service
`ANCHOR_API_URL` and `ANCHOR_TOKEN`.

## AnchorModule

```ts
import { Module } from "@nestjs/common";
import { AnchorModule } from "@anchor-secrets/nestjs";

@Module({
  imports: [AnchorModule.forRoot({ project: "shop", environment: "prod", path: "/api" })],
})
export class AppModule {}
```

```ts
import { Injectable } from "@nestjs/common";
import { AnchorService } from "@anchor-secrets/nestjs";

@Injectable()
export class Database {
  constructor(private readonly anchor: AnchorService) {}

  url() {
    return this.anchor.getOrThrow<string>("DATABASE_URL");
  }
}
```

- Secrets load while the application initializes. If loading fails, startup fails with an
  `AnchorError`, so the app never runs without its configuration.
- `AnchorService` reads synchronously: `get<T>(key)` (or `undefined`), `getOrThrow<T>(key)`
  (throws `Anchor secret KEY is not set`), `has(key)`, `keys()`, `toObject()`; `refresh()`
  fetches now. Typed values are decoded: a `number` secret is a number, `json` and `list` are
  parsed.
- Values refresh in the background: a read of values older than `cache.ttlMs` (default one
  minute) returns them at once and starts one refresh, a conditional request (`If-None-Match`)
  that Anchor answers with `304` when nothing changed. If Anchor is down, the app keeps its
  values and `onEvent` receives `refresh_failed`; with `cache.maxStaleMs` set, reads throw
  `AnchorError` code `stale` once that limit is passed.
- The module is global unless you pass `isGlobal: false`. `ANCHOR_OPTIONS` injects the options.
- Options are the SDK's: `project`, `environment`, `path?`, `expand?`, `includeImports?`,
  `apiUrl?`, `token?`, `timeoutMs?`, `retry?`, `cache?`, `onEvent?`, `fetch?`.

Options from other providers:

```ts
AnchorModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    project: "shop",
    environment: config.getOrThrow("APP_ENV"),
  }),
});
```

## loadAnchorEnv

For apps that read configuration from `process.env` (including `@nestjs/config`), copy the
secrets into the environment before Nest starts, and import the app module after that
(`ConfigModule.forRoot` reads and validates `process.env` when `app.module` loads):

```ts
// main.ts
import { NestFactory } from "@nestjs/core";
import { loadAnchorEnv } from "@anchor-secrets/nestjs";

async function bootstrap() {
  await loadAnchorEnv({ project: "shop", environment: "prod", path: "/api" });
  const { AppModule } = await import("./app.module");
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
void bootstrap();
```

Values are written as the strings Anchor stores. Variables that are already set win unless you
pass `override: true`. Nothing is written unless the whole folder loads, and no value is ever
logged. These values are written once and do not refresh.

Reserved names (`NODE_OPTIONS`, `PATH`, `LD_PRELOAD`, proxies, `ANCHOR_*`, ...) are skipped and
reported once as a process warning naming them; pass `allowReservedKeys: true` to load them.

## License

Apache-2.0

---
title: Load secrets in Node and NestJS
description: Read configuration from Anchor when a Node or NestJS service starts, with the SDK packages.
sidebar:
  order: 8
---

Two npm packages let a service read its configuration from Anchor at startup, without wrapping
the process in `anchor run`:

- `@anchor-secrets/sdk`: a small Node client (Node 20 or later, no runtime dependencies).
- `@anchor-secrets/nestjs`: a NestJS module built on it (NestJS 10, 11 or 12).

Both load a folder once, when the service starts. They do not refresh while it runs: restart the
service to pick up a change. They only read; writing secrets stays with the CLI and the dashboard.

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
Every value the service reads is in the project's audit log under the token's name.

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
  is refused, startup fails with an `AnchorError`: the service never runs without its
  configuration.
- `AnchorService` has `get(key)` (or `undefined`), `getOrThrow(key)` (throws
  `Anchor secret KEY is not set`), `has(key)` and `keys()`.
- Values are decoded by their type: a `number` secret is a number, a `boolean` a boolean, `json`
  and `list` are parsed; `string` and `pem` stay strings.
- The module is global, so feature modules can inject `AnchorService` without importing it. Pass
  `isGlobal: false` to change that. `ANCHOR_SECRETS` injects the raw `{ KEY: value }` record.

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
`@nestjs/config`, copy the secrets into the environment before Nest starts:

```ts
// main.ts
import { NestFactory } from "@nestjs/core";
import { loadAnchorEnv } from "@anchor-secrets/nestjs";
import { AppModule } from "./app.module";

async function bootstrap() {
  await loadAnchorEnv({ project: "zepo", environment: "prod", path: "/shared" });
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
void bootstrap();
```

`loadAnchorEnv` writes each value as the string Anchor stores. A variable that is already set
wins, so a local override still works; pass `override: true` to let Anchor win. It writes nothing
unless the whole folder loads, and logs nothing.

## Any Node service

```sh
npm install @anchor-secrets/sdk
```

```ts
import { createAnchorClient } from "@anchor-secrets/sdk";

const anchor = createAnchorClient(); // ANCHOR_API_URL and ANCHOR_TOKEN
const config = await anchor.loadSecrets({ project: "zepo", environment: "prod", path: "/shared" });
// { DATABASE_URL: "postgres://...", DB_POOL_SIZE: 20, FEATURE_FLAGS: { beta: true } }
```

- `loadSecrets` returns `{ KEY: value }` with values decoded as above; `listSecrets` returns each
  secret with its `key`, `path`, `type`, `sensitive`, `version`, `value` (a string) and
  `importedFrom`.
- Both take `{ project, environment, path?, expand?, includeImports? }`. `${...}` references are
  expanded and the folder's imports are included, as with `anchor run`, unless you pass `false`.
- `createAnchorClient({ apiUrl?, token?, fetch?, timeoutMs? })`: options win over the
  environment variables.

## Errors and retries

Every failure is an `AnchorError` with a `status` (0 when there was no response) and a `code`:

| `code` | Meaning |
|---|---|
| `config` | `ANCHOR_API_URL` or `ANCHOR_TOKEN` is missing; nothing was sent |
| `network`, `timeout` | Anchor could not be reached, or did not answer within 10 seconds |
| `unauthenticated` | The token is wrong, expired or revoked |
| `forbidden` | The token's scopes do not cover this environment or folder |
| `not_found` | The project, environment or folder does not exist |

Network errors, timeouts and HTTP 502, 503 and 504 are retried twice, after 250 ms and 1 s. Other
errors fail at once. Error messages never contain the token or a value.

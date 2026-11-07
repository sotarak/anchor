# @anchor-secrets/sdk

A Node client for [Anchor](https://sotarak.github.io/anchor/), a self-hosted secrets and
configuration manager that runs on your own Cloudflare account. Use it to load a folder of
secrets when your service starts, without wrapping the process in `anchor run`. For NestJS, use
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
const config = await anchor.loadSecrets({ project: "shop", environment: "prod", path: "/api" });
// { DATABASE_URL: "postgres://...", PORT: 8080, FEATURE_FLAGS: { beta: true } }
```

- `loadSecrets` returns `{ KEY: value }` with typed values decoded: `number` and `boolean` become
  numbers and booleans, `json` and `list` are parsed, `string` and `pem` stay strings.
- `listSecrets` returns the secrets with their metadata (`key`, `path`, `type`, `sensitive`,
  `version`, `value` as a string, `importedFrom`).
- Both take `{ project, environment, path?, expand?, includeImports? }`. `path` defaults to `/`;
  `${...}` references are expanded and folder imports are included unless you pass `false`.
- Options: `createAnchorClient({ apiUrl?, token?, fetch?, timeoutMs? })`.

## Errors and retries

Every failure is an `AnchorError` with `status` (0 when there was no response) and `code`:
`config` (URL or token missing, before any request), `network`, `timeout`, or the server's error
code such as `unauthenticated`, `forbidden` or `not_found`. Messages never contain tokens or
values.

Each attempt times out after 10 seconds. Network errors, timeouts and HTTP 502, 503 and 504 are
retried twice, after 250 ms and 1 s; other errors are not retried.

Every value the client reads is recorded in the project's audit log under the token's name.

## License

Apache-2.0

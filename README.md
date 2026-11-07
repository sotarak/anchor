# Anchor

Anchor is a self-hosted secrets and configuration manager that runs entirely on Cloudflare's
developer platform. One Worker serves the API, D1 stores everything, and every secret value is
encrypted with a per-project key that is itself wrapped by a root key held as a Worker secret. The
same Worker serves the web dashboard (`apps/web`), and the `anchor` CLI (`apps/cli`) covers
developer machines and CI.

## Features

- **Projects, environments and folders.** Secrets live at a path (`/`, `/api`, `/api/v2`) in an
  environment. Folders can be created empty; deleting a non-empty folder needs `--force`.
- **Version history and rollback.** Every write keeps the previous version. Past values can be
  revealed (audited), and a rollback saves an old version as a new one.
- **References.** A value can embed `${KEY}` (same folder) or `${env:/path/KEY}`; reads expand them
  on request (`--no-expand` turns it off, `$${` is a literal `${`). Cycles, missing keys and
  references the reader may not see fail the read instead of leaking or guessing. Expansion is
  capped: depth 5, 500 referenced secrets and 16 MiB of referenced bytes per request, 1 MiB per value.
- **Folder imports.** A folder can import other folders; local keys win, then imports in order.
- **Encryption.** AES-256-GCM per value under a per-project key (KEK), wrapped by a root key held
  as a Worker secret. Project keys rotate in the background through Cloudflare Queues; the root key
  rotates by re-wrapping. See the runbooks in [docs/deploy.md](docs/deploy.md).
- **Access control and audit.** Instance and project roles, environment-scoped members, scoped
  service tokens for CI, and an audit log of reads and changes (never values).
- **CLI.** `anchor run -- <cmd>`, `export`, `secrets get|set|list|delete|history|rollback`,
  `folders list|create|delete` — `anchor --help` lists every command.

```sh
anchor folders create /db
printf '%s' "$PASSWORD" | anchor secrets set PASSWORD --path /db
printf '%s' 'postgres://app:${PASSWORD}@db.internal/app' | anchor secrets set DB_URL --path /db
anchor run --path /db -- node server.js           # DB_URL arrives expanded
anchor secrets history DB_URL --path /db
anchor secrets rollback DB_URL --to 1 --path /db
```

## Development quickstart

```sh
pnpm install
pnpm test        # all packages (server layers: pnpm --filter ./apps/server test:unit | test:integration | test:api)
pnpm lint
pnpm typecheck

cd apps/server
cp .dev.vars.example .dev.vars   # fill in values from: openssl rand -base64 32
pnpm exec wrangler d1 migrations apply anchor --local
pnpm dev                         # http://localhost:8787
```

## Dashboard development

```sh
# Terminal 1: the API (see above), on http://localhost:8787
cd apps/server && pnpm dev

# Terminal 2: the dashboard with hot reload; /api is proxied to :8787
cd apps/web && pnpm dev          # http://localhost:5173
```

A fresh instance opens on `/setup`; use the `ANCHOR_SETUP_TOKEN` from `apps/server/.dev.vars`.
Production serves the built dashboard from the Worker itself (`pnpm build`, then `wrangler dev`
or deploy), with the strict CSP in `apps/web/public/_headers`.

```sh
cd apps/web
pnpm test                        # component and route tests (vitest + jsdom + msw)
pnpm lint:tokens                 # design-token lint
pnpm exec playwright install chromium
pnpm e2e                         # Playwright against a real `wrangler dev` on :8788
```

The e2e run builds the dashboard, starts the Worker with a throwaway D1 state and random keys under
`apps/web/test/e2e/.state/` (never your `.dev.vars`), runs the smoke (first-run setup), then the
M5 flow (folders, references, history, rollback), and fails on any CSP violation. The CLI has its
own end-to-end suite against a local Worker: `pnpm --filter ./apps/cli test:e2e`.

Deploying to Cloudflare: see [`docs/deploy.md`](docs/deploy.md). Test layout and conventions:
[`docs/testing.md`](docs/testing.md).

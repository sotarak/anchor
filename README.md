# Anchor

Anchor is a self-hosted secrets and configuration manager that runs entirely on Cloudflare's
developer platform. One Worker serves the API, D1 stores everything, and every secret value is
encrypted with a per-project key that is itself wrapped by a root key held as a Worker secret. The
same Worker serves the web dashboard (`apps/web`), and the `anchor` CLI (`apps/cli`) covers
developer machines and CI.

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
pnpm e2e                         # Playwright smoke against a real `wrangler dev` on :8788
```

The smoke builds the dashboard, starts the Worker with a throwaway D1 state and random keys under
`apps/web/test/e2e/.state/` (never your `.dev.vars`), and fails on any CSP violation.

Deploying to Cloudflare: see [`docs/deploy.md`](docs/deploy.md). Test layout and conventions:
[`docs/testing.md`](docs/testing.md).

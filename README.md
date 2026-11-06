# Anchor

Anchor is a self-hosted secrets and configuration manager that runs entirely on Cloudflare's
developer platform. One Worker serves the API, D1 stores everything, and every secret value is
encrypted with a per-project key that is itself wrapped by a root key held as a Worker secret. A
dashboard and a CLI are on the way (see `docs/superpowers/plans/`).

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

Deploying to Cloudflare: see [`docs/deploy.md`](docs/deploy.md). Test layout and conventions:
[`docs/testing.md`](docs/testing.md).

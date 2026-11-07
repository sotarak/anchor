---
title: Deploy to Cloudflare
description: Create the database and queues, set the root key, deploy the Worker and create the first owner.
sidebar:
  order: 1
---

Anchor runs as one Cloudflare Worker with one D1 database. One deployment serves one organization.

This guide covers the first deploy. The runbooks for a running instance (key rotation, audit
retention, rate limiting, recovery, upgrades) are under **Operations**.

## Prerequisites

- A Cloudflare account on the **Workers Paid** plan. Password hashing (PBKDF2, 100,000 iterations)
  needs more CPU per login than the Free plan allows (spec §12).
- Node.js 22+, pnpm, and `openssl`.
- `pnpm install` at the repository root. Run every command below from `apps/server`.

## 1. Create the database

```sh
pnpm exec wrangler d1 create anchor
```

Copy the `database_id` it prints into `wrangler.jsonc`, replacing the placeholder under
`d1_databases`.

## 2. Apply migrations

```sh
pnpm exec wrangler d1 migrations apply anchor --remote
```

## 2b. Create the re-encryption queues

Project key rotation re-encrypts secret values in the background through Cloudflare Queues
(spec §6.2). Create the work queue and its dead letter queue once, before the first deploy:

```sh
pnpm exec wrangler queues create anchor-reencrypt
pnpm exec wrangler queues create anchor-reencrypt-dlq
```

## 3. Generate, back up, then set the root key

The root key wraps every project's key, and those keys encrypt every secret value. Cloudflare never
shows a Worker secret again after you set it, so the backup has to happen first.

```sh
umask 077
openssl rand -base64 32 > anchor-root.key
```

> **Back up `anchor-root.key` offline now** (password manager or offline vault) and confirm the
> backup reads back the same value. Losing the root key loses every secret, permanently. There is no
> recovery path by design.

Then set it and remove the local file:

```sh
pnpm exec wrangler secret put ANCHOR_ROOT_KEY < anchor-root.key
rm anchor-root.key
```

Never replace `ANCHOR_ROOT_KEY` with a new random value on a deployment that already has data. Anchor
refuses to create projects under a root key that cannot open the existing ones (500 with a
`config_error` log), and every secret read fails until the original key is restored.

## 4. Set the setup token

```sh
openssl rand -base64 32 | tee /dev/stderr | pnpm exec wrangler secret put ANCHOR_SETUP_TOKEN
```

Keep the printed value for step 6. It is only needed once.

## 5. Deploy

From the repository root:

```sh
pnpm deploy:worker
```

`pnpm deploy:worker` builds the dashboard first (`pnpm build` writes `apps/web/dist`) and then runs
`wrangler deploy` for `apps/server`. The Worker serves the dashboard as static assets in
single-page-application mode: `/api/*` always reaches the Worker, and every other path that is not a
file serves `index.html`. Security headers (CSP, `X-Frame-Options`, ...) come from
`apps/web/public/_headers`. Running `wrangler deploy` alone ships whatever is in `apps/web/dist`.
(The script is not called `deploy`: `pnpm deploy` is a pnpm built-in and would run instead.)

The deploy also registers the daily Cron Trigger (`0 3 * * *`, from `triggers.crons` in
`wrangler.jsonc`). There is nothing to set up by hand: it purges audit events past retention (see
[Audit retention](/anchor/operations/audit-retention/)) and resumes stalled project key rotations (see
[Rotating a project key](/anchor/operations/project-key-rotation/)).

## 6. Create the first owner

```sh
curl -X POST https://<host>/api/v1/setup \
  -H 'content-type: application/json' \
  -d '{
    "setupToken": "<ANCHOR_SETUP_TOKEN value>",
    "email": "owner@example.com",
    "name": "Owner",
    "password": "<at least 12 characters>"
  }'
```

A `201` response means the owner exists. Setup works only once: later calls return `409`.
`GET /api/v1/setup/status` tells you whether setup is still needed.

## 7. Optional: remove the setup token

```sh
pnpm exec wrangler secret delete ANCHOR_SETUP_TOKEN
```

With the token unset, `POST /api/v1/setup` returns `503 setup_disabled`.

## 8. Manage users

The first owner manages everyone else on the dashboard's **Users** page (invite links valid 72
hours, role changes, disable, delete, password-reset links), or through the API at
`/api/v1/users` and `/api/v1/invites`. An instance always keeps at least one active owner: the API
refuses to demote, disable or delete the last one.

## Next steps

- [Rate-limit the public auth endpoints](/anchor/operations/rate-limiting/) before you share the URL.
- [Audit retention](/anchor/operations/audit-retention/)
- [Rotate a project key](/anchor/operations/project-key-rotation/) and
  [the root key](/anchor/operations/root-key-rotation/)
- [Break-glass: lost owner recovery](/anchor/operations/break-glass/)
- [Upgrade an instance](/anchor/operations/upgrading/)

## Local development

```sh
cp .dev.vars.example .dev.vars   # then fill in both values with openssl rand -base64 32
pnpm exec wrangler d1 migrations apply anchor --local
pnpm dev
```

`pnpm dev` (in `apps/server`) serves the API and the last dashboard build. For dashboard work, run
`pnpm --filter @anchor/web dev` as well: Vite serves the UI with hot reload and proxies `/api` to
`http://localhost:8787`.

To exercise the Cron Trigger locally, run `pnpm exec wrangler dev --test-scheduled` and request
`http://localhost:8787/__scheduled?cron=0+3+*+*+*`; the console shows an `audit_purged` line.

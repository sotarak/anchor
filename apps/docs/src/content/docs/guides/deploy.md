---
title: Deploy to Cloudflare
description: Deploy with the button or by hand, set the root key, and create the first owner.
sidebar:
  order: 1
---

Anchor runs as one Cloudflare Worker with one D1 database. One deployment serves one organization.

This guide covers the first deploy. The runbooks for a running instance (key rotation, audit
retention, rate limiting, recovery, upgrades) are under **Operations**.

## Prerequisites

- A Cloudflare account on the **Workers Paid** plan. Password hashing (PBKDF2, 100,000 iterations)
  needs more CPU per login than the Free plan allows (spec §12).
- `openssl`, to generate the root key.
- For the manual path only: Node.js 22+ and pnpm.

## Deploy with the button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/sotarak/anchor)

The button copies this repository to your GitHub or GitLab account and deploys it with
[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/). Its setup page asks for:

- **the repository** to create, and the **Worker name**;
- **the D1 database** (`DB`) and **the queues** (`anchor-reencrypt` and its dead letter queue).
  Keep the suggested names or pick your own: Cloudflare creates them and writes their IDs into your
  copy's `wrangler.jsonc`;
- **one secret**, `ANCHOR_ROOT_KEY`;
- the **build and deploy commands**, already filled in. The deploy command applies the database
  migrations and then deploys. Leave both as they are.

**Generate and back up the root key before you paste it.** The root key wraps every project's key,
and those keys encrypt every secret value. Cloudflare never shows a Worker secret again:

```sh
umask 077
openssl rand -base64 32 > anchor-root.key   # back this file up offline, then paste its value
```

> **Back up `anchor-root.key` offline now** (password manager or offline vault) and confirm the
> backup reads back the same value. Losing the root key loses every secret, permanently. There is no
> recovery path by design. Delete the local file once the backup is confirmed.

When the deploy finishes, open `https://<your-worker>/setup` and create the first owner.

> **Create the owner right after the deploy.** The first account created at `/setup` owns the
> instance, and until it exists anyone who reaches the URL can create it. Open `/setup` as soon as
> the deploy finishes. If it says the instance already has an owner and you did not create it, see
> [Troubleshooting](/anchor/troubleshooting/#setup-says-the-instance-already-has-an-owner).

Your copy is an independent repository, not a fork: it does not follow this one. Every push to its
default branch builds and deploys again. To take a new Anchor release, merge it into your copy (see
[Upgrade an instance](/anchor/operations/upgrading/)).

## Deploy manually

Clone the repository and run `pnpm install` at its root. Run every command below from the
repository root.

### 1. Create the database

```sh
pnpm exec wrangler d1 create anchor
```

Add the `database_id` it prints to the `DB` entry under `d1_databases` in `wrangler.jsonc`.

### 2. Create the re-encryption queues

Project key rotation re-encrypts secret values in the background through Cloudflare Queues
(spec §6.2). Create the work queue and its dead letter queue once, before the first deploy:

```sh
pnpm exec wrangler queues create anchor-reencrypt
pnpm exec wrangler queues create anchor-reencrypt-dlq
```

### 3. Generate, back up, then set the root key

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

### 4. Deploy

```sh
pnpm deploy:worker
```

`pnpm deploy:worker` builds the dashboard (`pnpm build` writes `apps/web/dist`), applies the D1
migrations, then runs `wrangler deploy`. (The script is not called `deploy`: `pnpm deploy` is a pnpm
built-in and would run instead.)

### 5. Create the first owner

> **Create the owner right after the deploy.** The first account created at `/setup` owns the
> instance, and until it exists anyone who reaches the URL can create it. Open `/setup` as soon as
> the deploy finishes. If it says the instance already has an owner and you did not create it, see
> [Troubleshooting](/anchor/troubleshooting/#setup-says-the-instance-already-has-an-owner).

Open `https://<your-worker>/setup` and create the owner. Or use the API:

```sh
curl -X POST https://<host>/api/v1/setup \
  -H 'content-type: application/json' \
  -d '{
    "email": "owner@example.com",
    "name": "Owner",
    "password": "<at least 12 characters>"
  }'
```

A `201` response means the owner exists. Setup works only once: later calls return `409`.
`GET /api/v1/setup/status` tells you whether setup is still needed.

## What the deploy sets up

The Worker serves the dashboard as static assets in single-page-application mode: `/api/*` always
reaches the Worker, and every other path that is not a file serves `index.html`. Security headers
(CSP, `X-Frame-Options`, ...) come from `apps/web/public/_headers`.

The deploy also registers the daily Cron Trigger (`0 3 * * *`, from `triggers.crons` in
`wrangler.jsonc`). There is nothing to set up by hand: it purges audit events past retention (see
[Audit retention](/anchor/operations/audit-retention/)) and resumes stalled project key rotations (see
[Rotating a project key](/anchor/operations/project-key-rotation/)).

Never replace `ANCHOR_ROOT_KEY` with a new random value on a deployment that already has data. Anchor
refuses to create projects under a root key that cannot open the existing ones (500 with a
`config_error` log), and every secret read fails until the original key is restored.

## Manage users

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

From the repository root:

```sh
cp .dev.vars.example .dev.vars   # then fill in ANCHOR_ROOT_KEY with openssl rand -base64 32
pnpm db:migrate:local
pnpm --filter @anchor/server dev
```

The server serves the API and the last dashboard build on `http://localhost:8787`. For dashboard
work, run `pnpm --filter @anchor/web dev` as well: Vite serves the UI with hot reload and proxies
`/api` to `http://localhost:8787`.

To exercise the Cron Trigger locally, run `pnpm exec wrangler dev --test-scheduled` and request
`http://localhost:8787/__scheduled?cron=0+3+*+*+*`; the console shows an `audit_purged` line.

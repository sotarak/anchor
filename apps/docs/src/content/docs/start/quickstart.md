---
title: Quickstart
description: The shortest path from a clone to a running instance and your first injected secret.
sidebar:
  order: 2
---

This page is the short version. The [deploy guide](/anchor/guides/deploy/) explains every step,
including how to back up the root key; read it before you store real secrets.

You need a Cloudflare account on the **Workers Paid** plan (password hashing needs more CPU per
login than the Free plan allows), Node.js 22+, pnpm and `openssl`.

## 1. Deploy the Worker

```sh
git clone https://github.com/sotarak/anchor.git && cd anchor
pnpm install
cd apps/server
pnpm exec wrangler login
pnpm exec wrangler d1 create anchor          # put the printed database_id in wrangler.jsonc
pnpm exec wrangler d1 migrations apply anchor --remote
pnpm exec wrangler queues create anchor-reencrypt
pnpm exec wrangler queues create anchor-reencrypt-dlq

umask 077 && openssl rand -base64 32 > anchor-root.key   # back this file up offline first
pnpm exec wrangler secret put ANCHOR_ROOT_KEY < anchor-root.key
rm anchor-root.key
openssl rand -base64 32 | tee /dev/stderr | pnpm exec wrangler secret put ANCHOR_SETUP_TOKEN

cd ../.. && pnpm deploy:worker                 # builds the dashboard, then deploys
```

Losing the root key makes every stored secret unreadable, permanently. Back it up before the `rm`,
somewhere other than this machine. Keep the printed setup token for the next step.

## 2. Create the first owner

Open `https://<your-worker>/setup`, paste the setup token, and create the owner account. Then
create a project and its environments in the dashboard.

## 3. Use the CLI

```sh
npm install -g @anchor-secrets/cli      # Node.js 22.19+, or:
brew install sotarak/tap/anchor
```

The [CLI guide](/anchor/guides/cli/#install) lists the other ways (install script, release
binaries).

```sh
anchor login --api-url https://<your-worker>
cd my-app
anchor init                       # pick the project and default environment
anchor secrets set DATABASE_URL   # hidden prompt
anchor run -- npm start           # npm start sees DATABASE_URL
```

Next steps: [the CLI guide](/anchor/guides/cli/), [using Anchor in CI](/anchor/guides/ci/), and
[rate-limiting the auth endpoints](/anchor/operations/rate-limiting/).

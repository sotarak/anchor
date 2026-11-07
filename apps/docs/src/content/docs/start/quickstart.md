---
title: Quickstart
description: The shortest path to a running instance and your first injected secret.
sidebar:
  order: 2
---

This page is the short version. The [deploy guide](/anchor/guides/deploy/) explains every step,
including how to back up the root key; read it before you store real secrets.

You need a Cloudflare account on the **Workers Paid** plan (password hashing needs more CPU per
login than the Free plan allows) and `openssl`.

## 1. Deploy the Worker

### With the button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/sotarak/anchor)

Cloudflare copies the repository to your account, creates the database and the queues, and asks for
one secret, the root key. Generate it first, and back it up offline **before** you paste it:

```sh
umask 077 && openssl rand -base64 32 > anchor-root.key   # ANCHOR_ROOT_KEY: back this file up offline
```

Leave the build and deploy commands as they are: the deploy command applies the migrations, then
deploys.

### By hand

Needs Node.js 22+ and pnpm. Every command runs from the repository root:

```sh
git clone https://github.com/sotarak/anchor.git && cd anchor
pnpm install
pnpm exec wrangler login
pnpm exec wrangler d1 create anchor          # add the printed database_id to wrangler.jsonc
pnpm exec wrangler queues create anchor-reencrypt
pnpm exec wrangler queues create anchor-reencrypt-dlq

umask 077 && openssl rand -base64 32 > anchor-root.key   # back this file up offline first
pnpm exec wrangler secret put ANCHOR_ROOT_KEY < anchor-root.key
rm anchor-root.key

pnpm deploy:worker                             # builds, applies migrations, deploys
```

Losing the root key makes every stored secret unreadable, permanently. Back it up before the `rm`,
somewhere other than this machine.

## 2. Create the first owner

Open `https://<your-worker>/setup` as soon as the deploy finishes and create the owner account: the
first account created there owns the instance. Then create a project and its environments in the
dashboard.

## 3. Use the CLI

```sh
npm install -g @anchor-secrets/cli                            # Node.js 22.19+
brew install sotarak/tap/anchor                               # macOS and Linux
curl -fsSL https://sotarak.github.io/anchor/install.sh | sh   # standalone binary
```

Pick one. The [CLI guide](/anchor/guides/cli/#install) also covers release binaries.

```sh
anchor login --api-url https://<your-worker>
cd my-app
anchor init                       # pick the project and default environment
anchor secrets set DATABASE_URL   # hidden prompt
anchor run -- npm start           # npm start sees DATABASE_URL
```

Next steps: [the CLI guide](/anchor/guides/cli/), [using Anchor in CI](/anchor/guides/ci/), and
[rate-limiting the auth endpoints](/anchor/operations/rate-limiting/).

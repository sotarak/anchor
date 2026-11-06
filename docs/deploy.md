# Deploying Anchor

Anchor runs as one Cloudflare Worker with one D1 database. One deployment serves one organization.

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

## 3. Set the root key

```sh
openssl rand -base64 32 | pnpm exec wrangler secret put ANCHOR_ROOT_KEY
```

The root key wraps every project's key, and those keys encrypt every secret value.

> **Back up the root key offline before going further.** Cloudflare will not show it to you again.
> Losing it loses every secret, permanently. There is no recovery path by design.

Generate the key into a file you then store in a password manager or offline vault if you prefer:
`openssl rand -base64 32 > root.key`, then `pnpm exec wrangler secret put ANCHOR_ROOT_KEY < root.key`,
then move `root.key` off the machine.

## 4. Set the setup token

```sh
openssl rand -base64 32 | tee /dev/stderr | pnpm exec wrangler secret put ANCHOR_SETUP_TOKEN
```

Keep the printed value for the next steps. It is only needed once.

## 5. Deploy

```sh
pnpm exec wrangler deploy
```

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

## Local development

```sh
cp .dev.vars.example .dev.vars   # then fill in both values with openssl rand -base64 32
pnpm exec wrangler d1 migrations apply anchor --local
pnpm dev
```

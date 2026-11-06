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

```sh
pnpm exec wrangler deploy
```

The deploy also registers the daily Cron Trigger (`0 3 * * *`, from `triggers.crons` in
`wrangler.jsonc`). There is nothing to set up by hand: it purges audit events past retention (see
[Audit retention](#audit-retention)).

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

The first owner manages everyone else through the API at `/api/v1/users` (list, change role,
disable, delete, create password-reset links) and `/api/v1/invites` (invite links, valid 72 hours).
The dashboard UI for this arrives in M4. An instance always keeps at least one active owner: the
API refuses to demote, disable or delete the last one.

## Audit retention

Audit events are kept for **365 days**. The table is append-only: a database trigger rejects every
`UPDATE`, and rejects `DELETE` of any row younger than 365 days. The daily Cron Trigger deletes the
older rows and logs an `audit_purged` line with the count.

### Rate-limit the public auth endpoints

Every failed login, including one for an email that does not exist, writes an audit row that
cannot be deleted for 365 days. Anchor itself does not rate-limit by IP yet. Without a limit,
anonymous traffic can grow the database until audit inserts fail, and because secret reads fail
closed when they cannot be audited, secret reads then fail too. Add a Cloudflare rate-limiting rule
(dashboard → Security → WAF → Rate limiting rules) for `POST /api/v1/auth/*` and
`POST /api/v1/invites/*`, for example 20 requests per minute per IP, and watch the D1 size.

## Break-glass: lost owner recovery

If no active owner can sign in (for example, the only owner was disabled or forgot their password
and no other owner exists), re-enable and promote a known account directly in D1:

```sh
pnpm exec wrangler d1 execute anchor --remote \
  --command "UPDATE users SET disabled_at = NULL, role = 'owner' WHERE email = '...'"
```

Then send that person a password-reset link from the API, or let them sign in if they know their
password. **This bypasses the API, so it leaves no audit event.** Record who ran it, when and why
in your own change log, and review the instance's users and audit log right after.

## Local development

```sh
cp .dev.vars.example .dev.vars   # then fill in both values with openssl rand -base64 32
pnpm exec wrangler d1 migrations apply anchor --local
pnpm dev
```

To exercise the Cron Trigger locally, run `pnpm exec wrangler dev --test-scheduled` and request
`http://localhost:8787/__scheduled?cron=0+3+*+*+*`; the console shows an `audit_purged` line.

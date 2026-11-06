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
[Audit retention](#audit-retention)) and resumes stalled project key rotations (see
[Rotating a project key](#rotating-a-project-key)).

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

## Rotating a project key

Each project has a key (KEK) that encrypts its secret values. A project admin rotates it with
`POST /api/v1/projects/<slug>/keys/rotate` (202). That creates a new key version for new writes,
marks the old one `retiring`, and re-encrypts existing values in the background, 100 versions per
queue message. Every value stays readable throughout. `GET /api/v1/projects/<slug>/keys` shows the
key versions and the rotation progress (`done` / `total`).

- The old key becomes `retired` only when no stored version uses it any more.
- Calling rotate again while a rotation runs resumes it (re-sends its message) instead of starting
  a second one.
- A message that keeps failing is retried 10 times, then lands in `anchor-reencrypt-dlq`. The daily
  Cron Trigger re-sends the message of any rotation idle for 15 minutes, as does the next rotate call.
- A stored value that fails its integrity check stops the rotation with status `failed` and error
  `decrypt_failed`, and logs `secret_decrypt_failed` with the ids. Treat it as an incident:
  investigate, then start a new rotation.

## Rotating the root key

The root key wraps every project key (KEK). Rotating it re-wraps those keys; secret values are
not touched. Every root key has an id, stored with each KEK it wraps: `ANCHOR_ROOT_KEY_ID`
(default `rk1`, format `^[a-z0-9-]{1,32}$`). While rotating, the old key stays configured as
`ANCHOR_ROOT_KEY_PREVIOUS` so existing data keeps working.

1. Generate the new key and back it up offline (see step 3 above):
   `umask 077 && openssl rand -base64 32 > anchor-root-new.key`
2. Set the old key and its current id as the previous key:
   `pnpm exec wrangler secret put ANCHOR_ROOT_KEY_PREVIOUS` (paste the old key) and
   `pnpm exec wrangler secret put ANCHOR_ROOT_KEY_PREVIOUS_ID` (the old id, `rk1` if you never
   set one).
3. Set the new key and a new id: `pnpm exec wrangler secret put ANCHOR_ROOT_KEY < anchor-root-new.key`
   and `pnpm exec wrangler secret put ANCHOR_ROOT_KEY_ID` (for example `rk2`).
4. Deploy (`pnpm deploy:worker`) if the secrets did not already trigger a new version.
5. As an instance owner, re-wrap every project key:
   `curl -X POST https://<host>/api/v1/admin/root-key/rewrap -H 'authorization: Bearer <token>'`
6. Check that `rewrapped` equals the number of project key rows, then call it again and expect
   `{ "rewrapped": 0 }`.
7. Remove the previous key: `pnpm exec wrangler secret delete ANCHOR_ROOT_KEY_PREVIOUS` (and
   `ANCHOR_ROOT_KEY_PREVIOUS_ID`).
8. Confirm the offline backup of the new key, then destroy the old key's backups only after you
   no longer need to restore a database backup taken before step 5.

A misconfiguration fails closed with `500 internal` and a `config_error` log: a previous key
without its id, a previous id equal to the current id, or project keys under an id that is not
configured. A previous key that does not match fails the rewrap with `secret_decrypt_failed` and
writes nothing.

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

`pnpm dev` (in `apps/server`) serves the API and the last dashboard build. For dashboard work, run
`pnpm --filter @anchor/web dev` as well: Vite serves the UI with hot reload and proxies `/api` to
`http://localhost:8787`.

To exercise the Cron Trigger locally, run `pnpm exec wrangler dev --test-scheduled` and request
`http://localhost:8787/__scheduled?cron=0+3+*+*+*`; the console shows an `audit_purged` line.

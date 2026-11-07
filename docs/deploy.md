# Deploying Anchor

Anchor runs as one Cloudflare Worker with one D1 database. One deployment serves one organization.

Runbooks after the first deploy:

- [Rotating a project key](#rotating-a-project-key) (background re-encryption through Queues)
- [Rotating the root key](#rotating-the-root-key) (re-wrap every project key)
- [Audit retention](#audit-retention) and [rate-limiting the auth endpoints](#rate-limit-the-public-auth-endpoints)
- [Break-glass: lost owner recovery](#break-glass-lost-owner-recovery)

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
key versions and the rotation progress (`done` / `total`). In the dashboard, the same controls are
on the project's **Encryption** page (project admins), which polls while a rotation runs.

- The old key becomes `retired` only when no stored version uses it any more.
- Calling rotate again while a rotation runs resumes it (re-sends its message) instead of starting
  a second one.
- A batch that keeps throwing (for example a project key that no longer unwraps) is retried with
  backoff (30 s, doubling, capped at an hour: about three hours in all); on its 10th attempt the rotation stops with status `failed` and error `retries_exhausted`, and
  `reencrypt_rotation_failed` is logged. Fix the cause, then start a new rotation. The daily Cron
  Trigger re-sends the message of any rotation still `running` but idle for 15 minutes, as does
  the next rotate call.
- A stored value that fails its integrity check stops the rotation with status `failed` and error
  `decrypt_failed`, and logs `secret_decrypt_failed` with the ids. Treat it as an incident:
  investigate, then start a new rotation.

## Rotating the root key

The root key wraps every project key (KEK). Rotating it re-wraps those keys; secret values are
not touched. Every root key has an id, stored with each KEK it wraps: `ANCHOR_ROOT_KEY_ID`
(default `rk1`, format `^[a-z0-9-]{1,32}$`). While rotating, the old key stays configured as
`ANCHOR_ROOT_KEY_PREVIOUS` so existing data keeps working.

Each `wrangler secret put` deploys a new Worker version immediately, and the intermediate states
(a previous key without its id, or a previous id equal to the current id) fail closed: every
secret read and write would return 500 until the last variable is set. So the four variables
change together, in one `wrangler secret bulk` request.

1. Generate the new key and back it up offline (see step 3 above):
   `umask 077 && openssl rand -base64 32 > anchor-root-new.key`. Restore the current key from its
   offline backup into `anchor-root.key` (same `umask 077` shell).
2. Write the four variables to a private JSON file, set them in one request, then delete the file.
   `OLD_ID` is the current id (`rk1` if you never set one); `NEW_ID` is the new one, for example
   `rk2`:

   ```sh
   umask 077
   OLD_ID=rk1 NEW_ID=rk2 node -e '
     const fs = require("node:fs");
     const read = (f) => fs.readFileSync(f, "utf8").trim();
     process.stdout.write(JSON.stringify({
       ANCHOR_ROOT_KEY_PREVIOUS: read("anchor-root.key"),
       ANCHOR_ROOT_KEY_PREVIOUS_ID: process.env.OLD_ID,
       ANCHOR_ROOT_KEY: read("anchor-root-new.key"),
       ANCHOR_ROOT_KEY_ID: process.env.NEW_ID,
     }));' > root-rotation.json
   pnpm exec wrangler secret bulk root-rotation.json
   rm root-rotation.json anchor-root.key anchor-root-new.key
   ```

   Both keys must already be in your offline backup before the `rm`.
3. Check the deployment: `GET /api/v1/health` answers, and a secret read still works.
4. As an instance owner, re-wrap every project key:
   `curl -X POST https://<host>/api/v1/admin/root-key/rewrap -H 'authorization: Bearer <token>'`
5. Check that `rewrapped` equals the number of project key rows, then call it again and expect
   `{ "rewrapped": 0 }`.
6. Remove the previous key and its id together (a previous key left without its id fails
   closed):

   ```sh
   echo '{"ANCHOR_ROOT_KEY_PREVIOUS": null, "ANCHOR_ROOT_KEY_PREVIOUS_ID": null}' > drop.json
   pnpm exec wrangler secret bulk drop.json && rm drop.json
   ```

7. Confirm the offline backup of the new key, then destroy the old key's backups only after you
   no longer need to restore a database backup taken before step 4.

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

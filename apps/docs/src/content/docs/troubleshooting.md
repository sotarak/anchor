---
title: Troubleshooting
description: Common errors when deploying or using Anchor, and how to fix them.
---

## Every secret read returns `500 internal`

The root key configuration is wrong. Look for one of two log lines (`pnpm exec wrangler tail` at the
repository root, or the Worker's **Logs** tab in the Cloudflare dashboard):

- **`config_error`**: a root key variable is missing or malformed, `ANCHOR_ROOT_KEY_PREVIOUS` is
  set without `ANCHOR_ROOT_KEY_PREVIOUS_ID`, or the previous id equals `ANCHOR_ROOT_KEY_ID`.
  Creating a project under a root key that cannot open the existing project keys logs it too.
- **`secret_decrypt_failed`** with a `projectId` and `kekVersion`: the project key was wrapped by a root key
  the Worker does not have. Either its id is not configured (a rotation was half done), or
  `ANCHOR_ROOT_KEY` was replaced with a new value on an instance that already has data.

Restore the right key from your offline backup, and change the root key variables together with
one `wrangler secret bulk` request, as in
[Rotate the root key](/anchor/operations/root-key-rotation/).

## A write returns `409 conflict`

Two writes raced (for example two people saving the same secret, or creating the same folder or
import) and the other one won. Reload and retry. The CLI retries `PUT` (secret writes are
idempotent) on network errors and on 429, 502, 503 and 504, never on 409.

## `400` with "Unresolved reference", "Reference cycle" or "Reference depth"

A value contains `${...}` that points to a missing secret, loops back on itself, or chains more
than 5 hops. Fix the value, or write a literal `${` as `$${`. With the CLI, `--no-expand` reads
the stored value so you can see it. See [References and imports](/anchor/guides/references-imports/).

## `403` naming a reference or an import

You (or the service token) may read the folder but not the folder a reference or import points
to. Ask a project admin to widen your environments, or the token's scopes.

## `429 rate_limited` at login

5 failed logins in a row lock the account for 15 minutes. Wait, or ask an instance admin for a
password-reset link.

## The dashboard loads a blank page or the console reports a CSP violation

The dashboard ships a strict Content Security Policy (`apps/web/public/_headers`). Browser
extensions that inject scripts, or a proxy that rewrites the HTML, can be blocked by it. Try a
private window. If you changed the dashboard, deploy with `pnpm deploy:worker` so the headers and
the build ship together; `wrangler deploy` alone ships whatever is in `apps/web/dist`.

## The install script stops with "checksum mismatch"

The script compares the downloaded binary with the release's `SHA256SUMS` and installs nothing when
they differ. A proxy or captive portal that rewrites downloads is the usual cause; an interrupted
download is the other. Run it again on a direct connection. If it still fails, do not bypass the
check: open an issue with the version and platform.

## `anchor: command not found` after installing

The install script puts `anchor` in `~/.local/bin` (or `ANCHOR_INSTALL_DIR`) and prints a hint when
that directory is not on your `PATH`. Add it to your shell profile and open a new terminal:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

After `npm install -g`, the command lives in npm's global bin directory (`npm prefix -g`, plus
`/bin` on macOS and Linux), which must be on `PATH` too.

## `npm install -g @anchor-secrets/cli` fails or the CLI will not start

The npm package needs Node.js 22.19 or later (`node --version`). On an older Node.js, upgrade it,
or use Homebrew or the install script, which ship a standalone binary with no Node.js requirement.

## The Deploy button's build fails (Workers Builds)

Open the failed build from the Worker's **Deployments** tab in the Cloudflare dashboard and read
the build log; Workers Builds runs `pnpm install`, the build command, then the deploy command.

- **The account is on the Free plan.** Anchor needs Workers Paid (see below), and the queues it
  uses are a paid feature. Upgrade the plan and retry the build.
- **`Couldn't find a D1 DB with the name or binding 'anchor'`** (or a similar `Couldn't find a D1 DB`
  line) from the migrations step: the database was not created before the deploy command ran.
  Create it with `pnpm exec wrangler d1 create anchor`, add the printed `database_id` to the `DB`
  entry in your copy's `wrangler.jsonc`, push, and the build retries.
- **An error naming `anchor-reencrypt-dlq` or `anchor-reencrypt`**: a queue was not created. Create
  both with `pnpm exec wrangler queues create anchor-reencrypt` and
  `pnpm exec wrangler queues create anchor-reencrypt-dlq`, then retry the build. Creating a queue
  that already exists fails harmlessly.

## `/setup` says the instance already has an owner

The first account created at `/setup` owns the instance. If you did not create it, someone reached
your URL first. Nothing of yours is stored yet. To see who did it, read the setup event (run from the
repository root, with your database's name):

```sh
pnpm exec wrangler d1 execute anchor --remote \
  --command "SELECT at, actor_label, ip FROM audit_events WHERE action = 'auth.setup'"
```

Then start over with an empty database and create the owner as soon as the deploy finishes:

1. Delete the database (`pnpm exec wrangler d1 delete anchor`, or in the Cloudflare dashboard under
   **Storage & Databases → D1**) and create it again (`pnpm exec wrangler d1 create anchor`).
2. Put the new `database_id` in the `DB` entry of `wrangler.jsonc` (your copy's, for a button
   deploy).
3. Deploy again: push to your copy for a button deploy, or run `pnpm deploy:worker`. Both apply the
   migrations to the new database.
4. Open `/setup` right away.

## Logins time out on the Free plan

Password hashing (PBKDF2, 100,000 iterations) needs more CPU per request than the Workers Free plan
allows, so sign-in and setup fail with a CPU-limit error (`1102`) or time out. Move the account to
Workers Paid; nothing else needs to change.

## `anchor` runs a different program

Another tool may install a binary named `anchor` (for example the Solana Anchor framework's
`anchor` CLI). Check with `which -a anchor`.

npm, Homebrew and the install script also install the CLI as `anchor-secrets`. Use that name,
optionally with `alias anchor=anchor-secrets` in your shell profile. With a raw release binary, put
Anchor's binary first on your `PATH`, call it by its full path, or install it under another name
and alias it:

```sh
sudo mv anchor-linux-x64 /usr/local/bin/anchor-secrets
alias anchor=anchor-secrets
```

## The CLI exits 2 in CI with a message about the API URL

`ANCHOR_TOKEN` is only sent to an API URL from `--api-url`, `ANCHOR_API_URL` or the user config.
Set `ANCHOR_API_URL` in the job. See [Use Anchor in CI](/anchor/guides/ci/).

## Still stuck

Search the [issues](https://github.com/sotarak/anchor/issues) or ask in
[Discussions](https://github.com/sotarak/anchor/discussions). Remove secret values and tokens from
anything you paste.

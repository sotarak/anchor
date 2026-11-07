---
title: Troubleshooting
description: Common errors when deploying or using Anchor, and how to fix them.
---

## Every secret read returns `500 internal`

The Worker logs say `config_error`. The root key configuration is inconsistent:

- `ANCHOR_ROOT_KEY_PREVIOUS` is set without `ANCHOR_ROOT_KEY_PREVIOUS_ID`, or the previous id
  equals `ANCHOR_ROOT_KEY_ID`;
- project keys are wrapped under a root key id that is not configured (a rotation was half done);
- `ANCHOR_ROOT_KEY` was replaced with a new random value on an instance that already has data.

Restore the right key from your offline backup, and change the root key variables together with
one `wrangler secret bulk` request, as in
[Rotate the root key](/anchor/operations/root-key-rotation/). See the logs with
`pnpm exec wrangler tail` in `apps/server`.

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

## `anchor` runs a different program

Another tool may install a binary named `anchor` (for example the Solana Anchor framework's
`anchor` CLI). Check with `which -a anchor`. Put Anchor's binary first on your `PATH`, call it
by its full path, or install it under another name and alias it:

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

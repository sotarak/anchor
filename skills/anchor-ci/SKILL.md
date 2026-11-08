---
name: anchor-ci
description: Use when a CI pipeline, deploy job, GitHub Actions workflow, cron job, server or other machine needs secrets from Anchor, when creating or rotating an Anchor service token, or when ANCHOR_TOKEN or ANCHOR_API_URL appear in CI configuration.
---

# Anchor in CI and on servers

## Overview

Machines do not log in. They use a **service token**: bound to one project, scoped to
environments and folders, `read` or `read-write`, and expiring (1–365 days, or `never`). A process
with `ANCHOR_TOKEN` and `ANCHOR_API_URL` set uses it instead of a login. Use the anchor-cli skill
alongside this one.

**Core principle: one narrow token per consumer, created by `anchor tokens create`, piped straight
into the place that stores it. You never see, print or paste the token.**

## 1. Create the token

```sh
anchor tokens create --name github-deploy --scope prod:/api --permission read --expires-in 90
```

- `--scope <env>` or `<env>:<path>` (repeatable): grant only what the job reads. A folder scope
  covers its subfolders (`prod:/api` reads `/api` and `/api/v2`, not `/`). If the folder imports
  `/shared`, add `--scope prod:/shared` too.
- `--permission read` unless the job writes secrets.
- `--expires-in`: days, default 90. Use `never` only for a machine nobody can rotate (a home
  server, an appliance) and only when the person asks for it; say the trade-off: a leaked `never`
  token works until someone revokes it. Otherwise pick days and tell the person when it expires.
- "Access to everything so it never breaks" still gets the scopes the job needs: explain that a
  broader token buys nothing but blast radius, and that a missing scope fails loudly (`403`).
- The token is printed **once**, alone on stdout (messages go to stderr). Pipe it to its store
  in the same command:

```sh
anchor tokens create --name github-deploy --scope prod:/api --permission read \
  | gh secret set ANCHOR_TOKEN --repo owner/repo          # GitHub Actions secret
anchor tokens create --name backup-box --scope prod:/db --permission read --expires-in never \
  | ssh backup@host 'umask 077; cat > ~/.anchor-token'   # a file only that user reads
```

If no CLI can receive it (GitLab, CircleCI web settings), ask the person to run
`anchor tokens create ...` themselves and paste the output into the CI secret settings.

## 2. Use it in the job

Set **both** variables: the CLI sends `ANCHOR_TOKEN` only to an API URL from `--api-url`,
`ANCHOR_API_URL` or the user config, never to the `apiUrl` in a committed `.anchor.json` (so a
pull request cannot redirect the token). Without `ANCHOR_API_URL` the CLI exits 2. The URL is not
secret; take it from `.anchor.json`.

GitHub Actions:

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: sotarak/anchor/setup-action@v0.4.0
        with:
          version: 0.4.0
      - run: npm ci && npm run build
      - name: Deploy
        env:
          ANCHOR_API_URL: https://anchor.example.com
          ANCHOR_TOKEN: ${{ secrets.ANCHOR_TOKEN }}
        run: anchor run --env prod --path /api -- npm run deploy
```

Other CI, or any machine:

```sh
curl -fsSL https://sotarak.github.io/anchor/install.sh | ANCHOR_VERSION=0.4.0 sh   # ~/.local/bin
npx -y @anchor-secrets/cli@0.4.0 run --env prod --path /api -- npm run deploy    # Node runners
```

- Pin the CLI version (`version:`, `ANCHOR_VERSION`, `@0.4.0`); do not use `latest` in pipelines.
- Give the token only to the steps that need it (step-level `env`, not the whole job).
- `anchor run -- <cmd>` starts the command only after every secret was fetched; an expired,
  revoked or under-scoped token exits 3 or 4 and the command never runs. Prefer it to
  `anchor export`; if a tool needs a file, `anchor export --output .env` writes mode 0600.
- `anchor run` removes `ANCHOR_TOKEN` from the command's environment; add `--pass-token` only when
  the command itself calls `anchor` or the SDK. Secrets named `PATH`, `NODE_OPTIONS`, `LD_*`,
  `*_PROXY`, `ANCHOR_*` and similar are skipped with a warning; `--allow-reserved` injects them.
- Pin third-party actions, `sotarak/anchor/setup-action` included, to a full commit SHA with the
  tag as a comment.
- On a server, load the token from a mode-600 file in the job, e.g.
  `ANCHOR_TOKEN=$(cat ~/.anchor-token) ANCHOR_API_URL=https://anchor.example.com anchor run --env prod -- ./backup.sh`.

## 3. Rotate and revoke

To rotate: create the new token, update the CI secret, then `anchor tokens revoke <old id>`
(`anchor tokens list` shows ids, expiry and last use). Revocation applies on the next request.
Every value a token reads is in the audit log under the token's name.

## Rules

- Never print, echo, log or paste a token: no `echo $TOKEN`, no `--json` output captured to a log,
  no token in a committed file, a workflow file or a chat message. Verify a stored token by
  running the job (or `anchor secrets list` with it), not by reading it back.
- Do not reuse a person's CLI session in CI, and do not put a token in `.anchor.json`.
- Changing a workflow that deploys on push is a change to production: leave the commit and push
  to the person unless they asked you to push.

## Common mistakes

| Mistake | Fix |
|---|---|
| Only `ANCHOR_TOKEN` set, CLI exits 2 | Add `ANCHOR_API_URL` (the server URL) |
| Guessing an npm package or `curl` to `/latest` | `sotarak/anchor/setup-action@v0.4.0`, the install script with `ANCHOR_VERSION`, or `npx -y @anchor-secrets/cli@0.4.0` |
| Token scoped to the whole environment "to be safe" | Scope to the folders the job reads (plus imported folders) |
| `read-write` for a deploy | `read`; writes need a separate, deliberate token |
| `--expires-in never` by default | Days, unless nobody can rotate it and the person asked |
| `403` after narrowing | The job reads another folder or an import source: add that scope |

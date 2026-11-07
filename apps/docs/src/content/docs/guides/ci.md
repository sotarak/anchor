---
title: Use Anchor in CI
description: Give a CI job scoped, expiring, read-only access to one environment with a service token.
sidebar:
  order: 6
---

CI jobs do not log in. They use a **service token**: a bearer token tied to one project, scoped to
environments and folders, read-only or read-write, with an expiry of 1 to 365 days.

## 1. Create a token

A project admin creates it in the dashboard (**Settings → Service tokens**) or with the CLI:

```sh
anchor tokens create --name github-deploy --scope prod --permission read --project my-app
```

- `--scope <env>` or `--scope <env>:<path>` (repeatable, up to 20). A folder scope covers its
  subfolders: `--scope prod:/api` reads `/api` and `/api/v2`, not `/`.
- `--permission read` (default) or `read-write`.
- `--expires-in <days>`, 1–365, default 90.

The token is shown **once**. Store it as a CI secret named `ANCHOR_TOKEN`, then forget it.

## 2. Use it in the job

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    env:
      ANCHOR_API_URL: https://anchor.example.com
      ANCHOR_TOKEN: ${{ secrets.ANCHOR_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - name: Install anchor
        run: |
          curl -fsSL -o anchor https://github.com/sotarak/anchor/releases/latest/download/anchor-linux-x64
          chmod +x anchor && sudo mv anchor /usr/local/bin/anchor
      - run: anchor run --project my-app --env prod -- npm run deploy
```

Pin a version (`releases/download/v0.1.0/anchor-linux-x64`) and check it against `SHA256SUMS` if
you want reproducible builds.

- **Set `ANCHOR_API_URL` next to `ANCHOR_TOKEN`.** The CLI only sends `ANCHOR_TOKEN` to an API URL
  from `--api-url`, `ANCHOR_API_URL` or the user config, never to the URL in a committed
  `.anchor.json`: a pull request cannot redirect your token to another host. Without it the CLI
  exits 2.
- `anchor run` starts the command only after every secret was fetched. A failed fetch (expired or
  revoked token, missing scope) exits 3 or 4 and the command never runs with a partial
  environment.
- `anchor export --format dotenv --output .env` writes a file with mode 0600 if a tool needs one;
  prefer `anchor run`, which writes nothing to disk.

## Rotate and revoke

- Revoke a token in **Settings → Service tokens** or with `anchor tokens revoke <id>`. The next
  request with it fails: there is no cache.
- The token list shows when each token was last used. Every read with a token is in the project's
  audit log under that token.
- To rotate, create the new token, update the CI secret, then revoke the old one.

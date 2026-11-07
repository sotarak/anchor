# Anchor

**Self-hosted secrets and configuration for your apps and CI, running entirely on your own
Cloudflare account.**

[![CI](https://github.com/sotarak/anchor/actions/workflows/ci.yml/badge.svg)](https://github.com/sotarak/anchor/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-sotarak.github.io%2Fanchor-dd224e.svg)](https://sotarak.github.io/anchor/)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/sotarak/anchor)

Needs a Cloudflare account on the Workers Paid plan. Read the
[deploy guide](https://sotarak.github.io/anchor/guides/deploy/) first: it shows how to generate and
back up the root key before you paste it.

![The Anchor dashboard: the secrets of a project's production environment, values masked](docs/media/secrets.png)

Anchor is a secrets manager in the spirit of Infisical, built on Cloudflare's developer platform:
one Worker serves the API and the dashboard, D1 stores everything, and Queues re-encrypt values in
the background when a key rotates. The `anchor` CLI injects secrets into local processes and CI
jobs.

```sh
npm install -g @anchor-secrets/cli                            # Node.js 22.19+
brew install sotarak/tap/anchor                               # macOS and Linux
curl -fsSL https://sotarak.github.io/anchor/install.sh | sh   # standalone binary
```

![The anchor CLI: log in, list a project's secrets, and run a command with them injected](docs/media/cli.gif)

|                                                                                        |                                                                              |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| ![Overview: which keys exist in each environment](docs/media/overview.png)             | ![History: every version of a secret, with rollback](docs/media/history.png) |
| **Overview.** See at a glance which keys are missing from an environment.              | **History.** Every write keeps a version; reveal or roll back any of them.   |
| ![Service tokens: scoped, expiring tokens for CI](docs/media/service-tokens.png)       | ![Audit log: logins, reads and changes, never values](docs/media/audit.png)  |
| **Service tokens.** Read or write, scoped to environments and folders, with an expiry. | **Audit log.** Who did what, to which secret, from where. Never the value.   |

## Why Anchor

- **Nothing to operate.** No servers, no database cluster, no unseal ceremony. An instance is one
  `wrangler deploy` on your account, and it scales with Cloudflare.
- **Your data stays with you.** Secrets live in your D1 database, encrypted under a root key that
  only your Worker holds.
- **Built for pipelines.** Scoped, expiring, revocable service tokens and a CLI that fails closed:
  `anchor run` never starts your command with a partial environment.
- **Free and fully featured when self-hosted**, under the Apache License 2.0.

## Features

- **Projects, environments and folders.** Secrets live at a path (`/`, `/api`, `/api/v2`) in an
  environment (`dev`, `staging`, `prod`, ...).
- **Encryption.** AES-256-GCM per value under a per-project key, wrapped by a root key held as a
  Worker secret. Project keys rotate online through Cloudflare Queues; the root key rotates by
  re-wrapping.
- **Version history and rollback.** Every write keeps the previous version. Past values can be
  revealed (audited), and a rollback saves an old version as a new one.
- **References.** A value can embed `${KEY}` (same folder) or `${env:/path/KEY}`. Every hop is
  authorized; cycles and missing keys fail the read instead of guessing.
- **Folder imports.** A folder can import other folders; local keys win, then imports in order.
- **Access control.** Instance roles (owner, admin, member), project roles (admin, developer,
  viewer) limited to chosen environments, and service tokens scoped to environments and folders.
- **Audit log.** Logins, reads and changes, never values. Append-only, kept for 365 days.
- **Dashboard and CLI.** A web dashboard served by the same Worker, and a CLI for developers and CI.

## Architecture

```
 browser ─┐          ┌──────────── your Cloudflare account ─────────────┐
 anchor ──┼─ HTTPS ─▶│ Worker: /api/v1 (Hono) + dashboard (static SPA)   │
 CI ──────┘          │   ├─ D1: users, projects, encrypted secrets, audit│
                     │   ├─ Queues: background re-encryption             │
                     │   └─ Cron: audit retention, resume rotations      │
                     └───────────────────────────────────────────────────┘

 root key (Worker secret) ─wraps→ project key (D1) ─encrypts→ secret values (D1)
```

More in [Architecture](https://sotarak.github.io/anchor/start/architecture/) and the
[security model](https://sotarak.github.io/anchor/security/model/).

## Quickstart

**With the button.** Click **Deploy to Cloudflare** above. Cloudflare copies this repository to
your GitHub account, creates the D1 database and the queues, and asks for one secret,
`ANCHOR_ROOT_KEY`. Generate it with `openssl rand -base64 32` and back it up offline before you
paste it. Every push to your copy redeploys.

**By hand** (Workers Paid plan, Node.js 22+, pnpm), from the repository root:

```sh
git clone https://github.com/sotarak/anchor.git && cd anchor && pnpm install
pnpm exec wrangler d1 create anchor        # add the database_id to wrangler.jsonc
pnpm exec wrangler queues create anchor-reencrypt && pnpm exec wrangler queues create anchor-reencrypt-dlq
# generate and back up the root key, then set ANCHOR_ROOT_KEY (see the guide)
pnpm deploy:worker                         # applies migrations, then deploys
```

Either way, open `https://<your-worker>/setup` as soon as the deploy finishes: the first account
created there owns the instance. **Read the
[deploy guide](https://sotarak.github.io/anchor/guides/deploy/) before storing real secrets**: it
covers backing up the root key, which cannot be recovered if lost.

## The CLI

Install it with one of the commands at the top. Release binaries and the GitHub Action for CI are
in the [CLI guide](https://sotarak.github.io/anchor/guides/cli/). Then:

```sh
anchor login --api-url https://anchor.example.com
anchor init                                        # link this directory to a project
anchor folders create /db
printf '%s' "$PASSWORD" | anchor secrets set PASSWORD --path /db
printf '%s' 'postgres://app:${PASSWORD}@db.internal/app' | anchor secrets set DB_URL --path /db
anchor run --path /db -- node server.js           # DB_URL arrives expanded
anchor secrets history DB_URL --path /db
anchor secrets rollback DB_URL --to 1 --path /db
```

Secret values are never accepted as arguments, never printed to a terminal without `--reveal`,
and `anchor run` writes nothing to disk.

## Documentation

**[sotarak.github.io/anchor](https://sotarak.github.io/anchor/)**

- [Introduction](https://sotarak.github.io/anchor/start/introduction/) and
  [quickstart](https://sotarak.github.io/anchor/start/quickstart/)
- [Deploy to Cloudflare](https://sotarak.github.io/anchor/guides/deploy/)
- [CLI](https://sotarak.github.io/anchor/guides/cli/) and
  [CI](https://sotarak.github.io/anchor/guides/ci/)
- [Operations runbooks](https://sotarak.github.io/anchor/operations/project-key-rotation/): key
  rotation, audit retention, rate limiting, recovery, upgrades
- [HTTP API](https://sotarak.github.io/anchor/reference/http-api/) and
  [limits](https://sotarak.github.io/anchor/reference/limits/)

Anchor is pre-1.0; see the [changelog](CHANGELOG.md).

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup and
checks, and sign off your commits (`git commit -s`, [DCO](https://developercertificate.org/)).
Questions go to [Discussions](https://github.com/sotarak/anchor/discussions). This project follows
the [Contributor Covenant](CODE_OF_CONDUCT.md).

## Security

Please report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md). Do not open a
public issue.

## License

[Apache License 2.0](LICENSE). Copyright 2026 Sota. Third-party notices are in [NOTICE](NOTICE).

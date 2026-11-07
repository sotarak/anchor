# Changelog

All notable changes to this project are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). One version covers the server,
dashboard and CLI.

## [Unreleased]

## [0.3.0] - 2026-11-07

### Added

- **Deploy to Cloudflare button.** One click copies the repository to your GitHub or GitLab
  account, creates the D1 database and the queues, asks for the root key, applies the migrations
  and deploys. Every push to the copy redeploys through Workers Builds.
- README screenshots of the dashboard and a recording of the CLI, regenerated from a seeded local
  instance with `pnpm --filter @anchor/web media`.
- Docs: deploying with the button, upgrading a button deploy (merge the release tag from upstream),
  upgrading and uninstalling the CLI for every install method, and troubleshooting for install and
  deploy failures.

### Changed

- **First-owner setup needs no setup token.** The first account created at `/setup` owns the
  instance; later attempts get `409` and never touch the existing owner. Create the owner right
  after deploying. `ANCHOR_SETUP_TOKEN` is no longer read, the `setup_disabled` (503) and
  invalid-token (403) responses are gone, and a request that still sends `setupToken` is accepted.
- The Worker config moved to the repository root: `wrangler.jsonc` and `.dev.vars.example` now live
  there, and every `wrangler` command runs from the root. New root scripts:
  `pnpm db:migrate:local`, and `pnpm deploy:worker` now applies the D1 migrations before deploying.
- Dashboard polish:
  - the header shows the project and environment as a breadcrumb;
  - the secrets table has its own Comment column and one-line rows;
  - overlays, menus, sheets and table rows fade and slide in gently, and stay still when the
    system asks for reduced motion;
  - the version history sheet is wider, so its dates and authors no longer wrap or clip.

### Fixed

- Every clickable control in the dashboard shows a pointer cursor; disabled ones show
  `not-allowed`.
- Table footers count one item in the singular ("1 token", not "1 tokens").
- The audit log names its targets (secret key, token name, email) instead of showing internal IDs.
- The CLI no longer warns "No OS keychain available" when `ANCHOR_CREDENTIAL_STORE=file` is set on
  purpose. A real fallback from the keychain still warns.

### Upgrade notes

- **Manual deploys:** move your `database_id` from `apps/server/wrangler.jsonc` into the root
  `wrangler.jsonc` (the `DB` entry), and move `apps/server/.dev.vars` to `.dev.vars` at the
  repository root. Run `wrangler` commands from the root from now on. The database name and
  binding are unchanged, so no data moves. See
  [Upgrade an instance](https://sotarak.github.io/anchor/operations/upgrading/).
- **Setup token:** nothing to do for an instance that already has an owner. Delete the unused
  `ANCHOR_SETUP_TOKEN` secret with `wrangler secret delete ANCHOR_SETUP_TOKEN`.
- **CLI:** no breaking changes; update to 0.3.0 with the tool you installed it with.

## [0.2.0] - 2026-11-07

### Added

- **CLI distribution.**
  - The CLI is published to npm as `@anchor-secrets/cli` (`npm install -g @anchor-secrets/cli`),
    with provenance.
  - Homebrew tap: `brew install sotarak/tap/anchor`.
  - Install script for macOS and Linux that verifies the download against `SHA256SUMS`:
    `curl -fsSL https://sotarak.github.io/anchor/install.sh | sh`.
  - GitHub Action for CI: `uses: sotarak/anchor/setup-action@v<version>`.
  - npm, Homebrew and the install script also install the CLI as `anchor-secrets`, for machines
    where another `anchor` is on `PATH`.

### Changed

- Tag releases are published right away instead of as drafts, and also publish to npm and
  Homebrew. Release tags are `v<version>` only; `cli-v<version>` tags no longer start a release.

## [0.1.0] - 2026-11-07

The first public release of Anchor: a self-hosted secrets manager that runs entirely on
Cloudflare Workers, D1 and Queues.

### Added

- **Core API and encryption.**
  - First-owner setup guarded by a setup token; password login with lockout.
  - Projects with environments.
  - Encrypted, versioned secret storage: AES-256-GCM per value under a per-project key (KEK),
    wrapped by a root key held as a Worker secret.
- **Access control and audit.**
  - Instance roles, and project memberships with environment restrictions.
  - Scoped, expiring, revocable service tokens.
  - Single-use invite links, password reset links and session management.
  - An append-only audit log of reads and changes, never values, with 365-day retention and a
    query API.
- **CLI (`anchor`).**
  - `login`/`logout`/`whoami`, with OS keychain or `0600` file credential storage.
  - `init` with a `.anchor.json` project file.
  - `secrets list|get|set|delete`, with values never accepted in argv.
  - `run -- <cmd>`, which injects env and forwards signals, and `export` to dotenv/JSON/YAML.
  - Service token commands.
  - `--json` on every command, and stable exit codes.
  - Release binaries for macOS, Linux and Windows.
- **Dashboard.**
  - Setup, login, invite and password-reset pages.
  - A projects overview matrix, the environment secrets view with masked values, and environment
    settings.
  - Members, service tokens with one-time reveal, users and invites, the audit log viewer, and an
    account page.
  - Served by the Worker with a strict CSP.
- **Advanced secrets.**
  - Folders, with guarded and forced deletion.
  - Version history, audited past-version reveal, and rollback.
  - Secret references (`${KEY}`, `${env:/path/KEY}`) with authorization on every hop and with
    cycle, depth and size limits.
  - Folder imports.
  - Background project-key rotation through Cloudflare Queues, and root-key rotation by re-wrapping.
- **Project.**
  - Licensed under the Apache License 2.0; contributions under the Developer Certificate of
    Origin, checked in CI.
  - A documentation site at https://sotarak.github.io/anchor/ (guides, operations runbooks,
    security model, API reference).

[Unreleased]: https://github.com/sotarak/anchor/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/sotarak/anchor/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/sotarak/anchor/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/sotarak/anchor/releases/tag/v0.1.0

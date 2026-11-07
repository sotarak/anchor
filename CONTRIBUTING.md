# Contributing to Anchor

Thanks for helping. Anchor guards other people's secrets, so we value correctness and tests over
speed. This guide covers the development setup, the checks a pull request must pass, and how to
sign off your commits.

- Questions: [GitHub Discussions](https://github.com/sotarak/anchor/discussions).
- Bugs and feature requests: [issues](https://github.com/sotarak/anchor/issues/new/choose).
- **Security vulnerabilities: never in a public issue.** See [SECURITY.md](SECURITY.md).

## Development setup

You need Node.js 22+, pnpm (the version in `package.json` `packageManager`; `corepack enable` picks
it up), and `openssl`.

```sh
pnpm install

# from the repository root, where wrangler.jsonc lives
cp .dev.vars.example .dev.vars   # fill in ANCHOR_ROOT_KEY with: openssl rand -base64 32
pnpm db:migrate:local
pnpm --filter @anchor/server dev # API and last dashboard build on http://localhost:8787
```

`.dev.vars` is git-ignored. Never commit it, real tokens, or any secret value.

For dashboard work, run the API as above and, in a second terminal:

```sh
cd apps/web && pnpm dev          # http://localhost:5173, /api proxied to :8787
```

A fresh instance opens on `/setup`, where the first account you create becomes the owner.

The docs site lives in `apps/docs` ([Starlight](https://starlight.astro.build)):

```sh
pnpm --filter @anchor/docs dev   # http://localhost:4321/anchor/
```

## Repository layout

| Path               | What                                                                                |
| ------------------ | ----------------------------------------------------------------------------------- |
| `apps/server`      | The Cloudflare Worker: API (Hono), D1 migrations, queue consumer, cron              |
| `apps/web`         | The dashboard (React, TanStack Router/Query), served by the Worker as static assets |
| `apps/cli`         | The `anchor` CLI (Commander)                                                        |
| `apps/docs`        | This project's documentation site                                                   |
| `packages/shared`  | Zod schemas and types shared by the server, dashboard and CLI                       |
| `docs/superpowers` | Design specs and implementation plans (project history)                             |
| `.claude`          | Optional agent skills and rules used to build Anchor (see below)                    |

## Checks

Every pull request runs these in CI; run them locally first:

```sh
pnpm lint                        # Biome (format + lint)
pnpm typecheck
pnpm test                        # every package (server layers: pnpm --filter ./apps/server test:unit | test:integration | test:api)
pnpm test:scripts                # repository scripts (node --test)
pnpm --filter @anchor/web lint:tokens
pnpm --filter @anchor/docs build # fails on broken links
```

End-to-end suites, slower, also in CI:

```sh
pnpm --filter ./apps/cli test:e2e                  # CLI against a local Worker
pnpm --filter @anchor/web exec playwright install chromium
pnpm --filter @anchor/web e2e                      # dashboard against wrangler dev
```

The dashboard e2e run builds the dashboard, starts the Worker on :8788 with a throwaway D1 state
and random keys under `apps/web/test/e2e/.state/` (never your `.dev.vars`), runs the first-run
setup smoke and the folders, references, history and rollback flow, and fails on any CSP
violation. Production serves the built dashboard from the Worker itself, with the strict CSP in
`apps/web/public/_headers`.

Tests live in a layered `test/` tree beside `src/`; see the
[test layout guide](https://sotarak.github.io/anchor/contributing/testing/).

## Conventions

- **English** for code, comments, commits and docs.
- **Biome** formats and lints; `pnpm format` fixes formatting.
- **Tests first.** A bug fix starts with a test that fails without it.
- **Security-sensitive changes** (crypto, authorization, tokens, audit) need tests that prove the
  failure cases, not only the happy path. Never log secret values.
- **Dependencies** respect pnpm's `minimumReleaseAge`: do not add exclusions to install a release
  that is only hours old.
- Keep pull requests focused; describe what changed and how you tested it.

## Sign your commits (DCO)

Anchor uses the [Developer Certificate of Origin](https://developercertificate.org/) instead of a
CLA. By adding a `Signed-off-by` line you certify that you wrote the change or otherwise have the
right to submit it under the project's license (Apache-2.0).

```sh
git commit -s -m "fix(cli): ..."
```

This appends `Signed-off-by: Your Name <your email>` using your git `user.name` and `user.email`,
which must match the commit author. A CI check rejects pull requests with unsigned commits. To fix
the commits of an existing branch: `git rebase --signoff main`, then force-push your branch.

Contributions are accepted under the Apache License 2.0 (section 5 of the license).

## Releasing

One version covers the server, dashboard and CLI. To release `X.Y.Z`:

1. Set `"version": "X.Y.Z"` in every `package.json` (the root, `apps/*` and `packages/*`) and add a
   `## [X.Y.Z] - <date>` section to `CHANGELOG.md`.
2. Merge to `main`, then push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.

The tag runs `.github/workflows/release-cli.yml`. It checks that the tag, the versions and the
changelog agree, builds the binaries, then publishes the release right away (no draft):

- a GitHub Release with the binaries, `SHA256SUMS` and the changelog section as notes;
- `@anchor-secrets/cli` on npm, through trusted publishing with provenance (a version already on
  npm is skipped);
- `Formula/anchor.rb` in [`sotarak/homebrew-tap`](https://github.com/sotarak/homebrew-tap).

A pre-release version (`X.Y.Z-rc.1`) becomes a GitHub pre-release, goes to the npm dist-tag `next`,
and does not touch Homebrew. Running the workflow by hand, even from a tag, makes a `cli-dev-<n>`
draft and publishes nothing else.

If a job fails (for example the first npm publish), fix the cause and re-run the workflow: the
existing GitHub Release is kept as it is, a version already on npm is skipped, and the formula is
rebuilt from the release's `SHA256SUMS`.

One-time setup (maintainer):

- Create the npm organization `anchor-secrets`. If npm only lets you add a trusted publisher to a
  package that already exists, publish the first version by hand:
  `pnpm --filter ./apps/cli pack`, then `npm publish anchor-secrets-cli-X.Y.Z.tgz --access public`.
- On npmjs.com, add a trusted publisher to `@anchor-secrets/cli`: GitHub Actions, repository
  `sotarak/anchor`, workflow `release-cli.yml`.
- Create the public repository `sotarak/homebrew-tap`. Create a fine-grained personal access token
  with **Contents: read and write** on that repository only, and store it as the Actions secret
  `HOMEBREW_TAP_TOKEN` of `sotarak/anchor`. Without it the release warns and skips Homebrew.

## AI-assisted development

Anchor was built with AI coding agents. The `.claude/` directory holds the skills and rules they
follow (vendored third-party skills are listed in `.claude/VENDORED.md`), and `docs/superpowers/`
holds the design specs and plans. You do not need any of it to contribute. If you use an agent,
the same rules apply: you are responsible for every line you submit. Commits written with an agent
may carry a co-author trailer such as `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).

---
title: Upgrade an instance
description: Move a running instance to a new Anchor release, migrations first, and update the CLI.
sidebar:
  order: 6
---

Anchor is pre-1.0: read the [changelog](https://github.com/sotarak/anchor/blob/main/CHANGELOG.md)
for every version between yours and the target before upgrading. Breaking changes and manual
steps are listed there. Below, `v<version>` stands for the release you are moving to, such as
`v0.3.0`.

## Back up the database first

D1 Time Travel can restore any minute of the last 30 days (Workers Paid), but take an explicit
bookmark first. Use your database's name (`anchor` unless you picked another one):

```sh
pnpm exec wrangler d1 time-travel info anchor
```

Note the bookmark it prints. To restore:
`pnpm exec wrangler d1 time-travel restore anchor --bookmark=<bookmark>`.

## If you deployed with the button

Your copy is an independent repository. Pull the release into it from this one, then push:

```sh
git remote add upstream https://github.com/sotarak/anchor.git   # once
git fetch upstream --tags
git merge v<version>
git push
```

Workers Builds picks up the push, applies the new migrations, and deploys. If the merge conflicts in
`wrangler.jsonc`, keep your own IDs (`database_id`, queue names, Worker name) and take everything
else from the release.

If git stops with `fatal: refusing to merge unrelated histories`, your copy started from a fresh
commit instead of this repository's history. Do the first merge like this, once:

```sh
git merge --allow-unrelated-histories -X theirs v<version>
git diff HEAD~1 -- wrangler.jsonc   # put your own IDs and names back, then commit
```

`-X theirs` takes the release's side of every conflict, so restore your `database_id`, queue names
and Worker name in `wrangler.jsonc` before you push. Files the release deleted stay in your copy;
remove them by hand (compare with `git diff --stat v<version>`). Later upgrades merge normally.

## If you deployed manually

From the repository root:

```sh
git fetch --tags
git merge v<version>             # or check it out on a branch that keeps your wrangler.jsonc edits
pnpm install --frozen-lockfile
pnpm exec wrangler d1 migrations list DB --remote   # what will run
pnpm deploy:worker                                  # applies migrations, then deploys
```

Every migration so far only adds tables, columns, indexes and triggers, so the running version keeps
working against the new schema while the deploy finishes; the changelog calls out any migration that
does not.

Your `wrangler.jsonc` holds your own `database_id`. Keep that change on a local branch (or re-apply
it after each upgrade) so upgrades do not overwrite it.

> **0.3.0 moved the Worker config to the repository root.** If you deployed manually before 0.3.0,
> move your `database_id` from `apps/server/wrangler.jsonc` into the root `wrangler.jsonc`, and move
> `apps/server/.dev.vars` to `.dev.vars` at the root. Run every `wrangler` command from the root
> from now on. The database name and binding are unchanged, so no data moves.

> **0.3.0 removed the setup token.** `/setup` no longer asks for one: the first account created there
> owns the instance, and an instance that already has an owner is unaffected. `ANCHOR_SETUP_TOKEN` is
> no longer read; delete it with `pnpm exec wrangler secret delete ANCHOR_SETUP_TOKEN` (or under the
> Worker's **Settings → Variables and Secrets**). Scripts that still send `setupToken` keep working.

If a release changes Worker configuration (a new binding or queue in `wrangler.jsonc`), the changelog
says so; create the resource before you deploy.

## Check the instance

Check `GET /api/v1/health`, sign in to the dashboard, and read one secret.

## Update the CLI

Move developer machines and CI to the same release:

```sh
npm install -g @anchor-secrets/cli@<version>                                  # npm
brew update && brew upgrade anchor                                            # Homebrew
curl -fsSL https://sotarak.github.io/anchor/install.sh | ANCHOR_VERSION=<version> sh   # install script
```

In GitHub Actions, bump the setup action to `sotarak/anchor/setup-action@v<version>`. The
[CLI guide](/anchor/guides/cli/#upgrade-and-uninstall) covers every install method.

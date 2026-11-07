---
title: Upgrade an instance
description: Move a running instance to a new Anchor release, migrations first.
sidebar:
  order: 6
---

Anchor is pre-1.0: read the [changelog](https://github.com/sotarak/anchor/blob/main/CHANGELOG.md)
for every version between yours and the target before upgrading. Breaking changes and manual
steps are listed there.

1. **Back up the database.** D1 Time Travel can restore any minute of the last 30 days (Workers
   Paid), but take an explicit bookmark first:

   ```sh
   pnpm exec wrangler d1 time-travel info anchor
   ```

   Note the bookmark it prints. To restore: `pnpm exec wrangler d1 time-travel restore anchor
   --bookmark=<bookmark>`.
2. **Check out the release** you are moving to:

   ```sh
   git fetch --tags && git checkout v0.1.0   # the target version
   pnpm install --frozen-lockfile
   ```

3. **Apply migrations** before deploying the new code. Every migration so far only adds tables,
   columns, indexes and triggers, so the running version keeps working against the new schema;
   the changelog calls out any migration that does not:

   ```sh
   cd apps/server
   pnpm exec wrangler d1 migrations list anchor --remote    # what will run
   pnpm exec wrangler d1 migrations apply anchor --remote
   ```

4. **Deploy** from the repository root: `pnpm deploy:worker`.
5. **Check** `GET /api/v1/health`, sign in to the dashboard, and read one secret.
6. **Update the CLI** on developer machines and in CI to the same release.

If a release changes Worker configuration (a new binding or queue in `wrangler.jsonc`), the
changelog says so; create the resource before step 4.

Your `wrangler.jsonc` holds your own `database_id`. Keep that change on a local branch (or
re-apply it after checkout) so upgrades do not overwrite it.

---
name: anchor-migrate
description: Use when moving secrets or configuration from .env files, YAML or JSON config files, or hard-coded settings into Anchor, when someone asks to get rid of .env files or to take secrets out of a committed config file, or when switching a project's start scripts to anchor run.
---

# Migrating configuration into Anchor

## Overview

`anchor secrets import` moves a whole dotenv, JSON or YAML file into one Anchor folder. Nested keys
become UPPER_SNAKE (`configs.openrouter.api_key` → `CONFIGS_OPENROUTER_API_KEY`), types are
inferred, blank values are skipped, existing keys are skipped unless `--overwrite`, and values are
never printed. Use the anchor-cli skill alongside this one: its rule that secret values never pass
through you applies here too.

**Core principle: the plaintext files are the only copy until the person has seen the result
working. You import, verify and report; the person decides when the old files go.**

## The migration

1. **Map services to folders.** One folder per service (`/api`, `/worker`), and `/shared` for
   values several services use. `anchor run` reads one folder, so a service that needs shared
   values gets an **import** of `/shared` into its folder. Create the folders with
   `anchor folders create /api --env prod`, then add the import yourself and check it:
   ```sh
   anchor imports add prod:/shared --env prod --path /api
   anchor imports list --env prod --path /api
   ```
   The import is live (keys added to `/shared` later show up in `/api` on the next read) and
   local keys win over imported ones. It is idempotent, and `anchor imports remove` undoes it.
2. **Check the target environment.** A developer's `apps/api/.env` usually holds `dev` values.
   Ask which environment each file belongs to before importing a local `.env` into `prod`.
3. **Dry run.** Run each import with `--dry-run` first:
   ```sh
   anchor secrets import --from-file apps/api/.env --env prod --path /api \
     --non-sensitive 'PORT' --non-sensitive 'LOG_LEVEL' --dry-run
   anchor secrets import --from-file config/application.config.yaml --env prod --path /shared \
     --non-sensitive 'CONFIGS_AGENT_*' --non-sensitive 'CONFIGS_CONTEXT_*' --dry-run
   ```
   The plan table (KEY, TYPE, SENSITIVE, ACTION, and **empty** source paths) is your inventory:
   it shows every key name and type without a value. Every key is sensitive unless a
   `--non-sensitive <glob>` matches the final UPPER_SNAKE key; add globs only for plain config
   (ports, hosts, log levels, model names, limits, flags). Adjust and dry-run again until the plan
   is right, then run the same command without `--dry-run`.
4. **Point the app at Anchor.** Pick the case that matches the code:
   - The app reads environment variables already: nothing to change.
   - The config loader expands `${VAR}` from the environment: replace each migrated value in the
     file with `${IMPORTED_KEY_NAME}`, using the names from the dry-run table. Leave blank keys
     and plain values the person wants to keep in the file alone.
   - The loader reads the file literally (plain `json.load`, `yaml.safe_load`): change the code
     to read the values from the environment, with typed parsing for numbers and booleans, and
     remove the migrated values from the file.
5. **Switch the start scripts.** Local and test scripts become `anchor run -- <command>` (for
   example `"start": "anchor run -- node dist/main.js"`). Servers and CI need a service token in
   `ANCHOR_TOKEN`: see the anchor-ci skill; do not change a deploy you cannot see, say what is
   needed instead.
6. **Verify by running.** `anchor run --env <env> --path /api -- <start or test command>`. To
   check names, list them: `anchor secrets list --env prod --path /api`. That is the proof.
7. **Report and ask.** Tell the person what was imported where (from the import summary),
   which keys are plain config, what changed in code and scripts, and what is left. Then ask
   whether to delete the old plaintext files. Delete or `git rm` them only after they say yes.
8. **History.** Values that were committed stay in git history after the file is changed. Tell
   the person to rotate them; do not rewrite history unless asked.

## Rules

- Inspect files through the dry-run table, not by reading them. Do not `cat`, `sed`, `yq` or
  `grep` a file that holds secret values in a way that prints them, and do not write filtered or
  temporary copies of it: each copy is one more plaintext file to leak. If the import refuses the
  file (an invalid key name, two paths that become the same key), report the listed problems and
  let the person decide how to fix the source.
- Do not compare old and new values (hashes, diffs, `--reveal`) to prove the migration. The
  import reports every key it wrote; running the app is the check.
- Do not pass `--overwrite` unless the person asked to replace existing values.

## Rationalizations

| Excuse | Reality |
|---|---|
| "They asked me to get rid of the files, that is the confirmation" | The request came before anyone saw the result. A gitignored `.env` has no other copy. Ask after the report. |
| "It is tracked in git, so `git rm` is recoverable" | Recoverable by digging through history, which is the plaintext you are trying to retire. Ask first. |
| "They are in meetings, I'll finish end to end" | Finish everything except the deletion, and leave the question in your report. |
| "I'll make a filtered copy of the YAML to import only the secrets" | Import the original file and use `--non-sensitive` globs; a copy is another plaintext file. |
| "Hashing the values proves nothing was lost" | It reads every value through your shell. The import summary and a working `anchor run` prove it. |
| "Shared values can go in `/` and each service in its own folder" | `anchor run` reads one folder. Use `/shared` plus an import into each service folder. |

## Red flags — stop

- `rm`, `git rm` or overwriting a plaintext config file before the person said yes after your report
- A command that prints values from the source file, or writes a copy of it
- Importing a developer's local `.env` into `prod` without asking which environment it is for
- `${KEY}` placeholders in a file whose loader does not expand them

# Anchor CLI command reference

`anchor` (also installed as `anchor-secrets`). Global options work on every command:
`--project <slug>`, `--env <slug>`, `--path <path>` (folder, default `/`), `--api-url <url>`,
`--json` (data on stdout), `-q`, `--no-color`, `--debug` (never prints values), `-y/--yes`.
Without them the CLI uses `.anchor.json` in the directory or a parent.

## Session and project

| Command | Does |
|---|---|
| `anchor whoami` | Who is signed in (user or service token), or "Not logged in" |
| `anchor login` | Browser sign-in, the person approves on the dashboard; session lasts 30 days |
| `anchor login --no-browser` | Prints the URL instead of opening a browser |
| `anchor logout` | Revokes the session on the server and deletes it locally |
| `anchor init [--project p --env e]` | Writes `.anchor.json` (identifiers only, safe to commit) |
| `anchor projects list`, `anchor envs list` | Discover slugs |
| `anchor folders list`, `anchor folders create /api/v2` | Folders of an environment |
| `anchor imports list [--path /api]` | Folders that `--path` imports, in the order they apply |
| `anchor imports add prod:/shared --path /api` | `/api` also shows `/shared`'s secrets (live: new keys appear on the next read; local keys win). No-op if already imported |
| `anchor imports remove prod:/shared --path /api` | Stop importing; confirms (non-TTY needs `--yes`) |

`anchor imports` links folders; `anchor secrets import` loads a file. Different commands.

## Reading

| Command | Does |
|---|---|
| `anchor secrets list` | Keys, type, sensitive flag, version, comment; values of **non-sensitive** keys only |
| `anchor secrets list --json` | Same, as JSON |
| `anchor secrets list --reveal` | Adds sensitive values. Audited. Do not run on the person's behalf |
| `anchor secrets get KEY` | One secret; a sensitive value is masked in a terminal unless `--reveal` |
| `anchor secrets get KEY --at-version 2` | A past version (stored value) |
| `anchor secrets history KEY` | Versions, who and when, no values |

## Running and exporting

| Command | Does |
|---|---|
| `anchor run -- <cmd> [args]` | Runs `<cmd>` with the folder's secrets as environment variables; `${KEY}` references expanded; exit code passed through; nothing written to disk |
| `anchor run --env prod --path /api -- node server.js` | Another environment or folder |
| `anchor run --no-override -- <cmd>` | Variables already set in the shell win |
| `anchor export --output .env.local` | Writes dotenv (mode 0600). Only to a gitignored file |
| `anchor export --format json\|yaml` | Other formats; typed values keep their type in JSON/YAML |

## Writing

The value never goes in argv. It comes from a hidden prompt, stdin or a file.

| Command | Does |
|---|---|
| `anchor secrets set KEY` | Hidden prompt (the person types it) |
| `printf '%s' "$VAR" \| anchor secrets set KEY` | From stdin |
| `anchor secrets set KEY --from-file key.pem --type pem` | Exact file bytes |
| `--type string\|json\|pem\|number\|boolean\|list` | Checked before sending; default keeps the current type |
| `--no-sensitive` | Plain config: readable without `--reveal` (ports, hostnames, flags). New secrets are sensitive by default |
| `--comment <text>` | Stored with the version |
| `anchor secrets delete KEY [--yes]` | Deletes (asks first; `--yes` in scripts) |
| `anchor secrets rollback KEY --to 2 [--yes]` | Restores a past version as a new version |
| `anchor secrets import --from-file .env --dry-run` | Bulk import; see the anchor-migrate skill |

References inside values: `${KEY}` (same folder), `${prod:/db/PASSWORD}` (environment and folder); `$${` is a literal `${`.

## Service tokens (CI, servers)

| Command | Does |
|---|---|
| `anchor tokens create --name ci --scope prod --permission read` | Printed once on stdout; default expiry 90 days |
| `--scope env:/path` (repeatable), `--permission read\|read-write`, `--expires-in <1-365>\|never` | Scope and lifetime |
| `anchor tokens list`, `anchor tokens revoke <id> [--yes]` | Manage |

A process with `ANCHOR_TOKEN` set uses that token instead of the stored session.

## Exit codes and errors

`0` success, `1` failure, `2` usage error; "Not logged in. Run 'anchor login' first." means the
person must sign in. A `403` means the user or token lacks access to that environment or folder.

---
title: CLI
description: Install the anchor CLI, log in, manage secrets and run commands with secrets injected.
sidebar:
  order: 3
---

`anchor` is the command-line client for Anchor. Developers use it to log in, link a directory to a
project, manage secrets and run commands with secrets injected. CI uses it with a service token.

## Install

npm, Homebrew and the install script all install two commands, `anchor` and `anchor-secrets`.
They are the same program. Use `anchor-secrets` when another tool already owns `anchor` on your
`PATH` (see [Troubleshooting](/anchor/troubleshooting/)).

### npm (macOS, Linux, Windows)

Needs Node.js 22.19 or later.

```sh
npm install -g @anchor-secrets/cli
npx @anchor-secrets/cli --help        # or run it without installing
```

### Homebrew (macOS, Linux)

```sh
brew install sotarak/tap/anchor
```

### Install script (macOS, Linux)

```sh
curl -fsSL https://sotarak.github.io/anchor/install.sh | sh
```

The script picks the release binary for your platform, verifies it against the release's
`SHA256SUMS`, and installs it to `~/.local/bin` without sudo. Nothing is installed if the checksum
does not match. Read it first if you pipe scripts to `sh`. Options are environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANCHOR_VERSION` | `latest` | Version to install, `0.2.0` or `v0.2.0` |
| `ANCHOR_INSTALL_DIR` | `~/.local/bin` | Target directory |
| `ANCHOR_DOWNLOAD_BASE` | `https://github.com/sotarak/anchor/releases` | Release mirror |

```sh
curl -fsSL https://sotarak.github.io/anchor/install.sh | ANCHOR_VERSION=0.2.0 sh
```

### Release binaries

Every [GitHub Release](https://github.com/sotarak/anchor/releases) has single-file binaries
(`anchor-darwin-arm64`, `anchor-darwin-x64`, `anchor-linux-x64`, `anchor-linux-arm64`,
`anchor-windows-x64.exe`) and a `SHA256SUMS` file. Check the binary against `SHA256SUMS`, make it
executable, and put it on your `PATH` as `anchor` (`anchor.exe` on Windows). This is the
Windows install path when Node.js is not available.

### From the workspace

- `pnpm --filter ./apps/cli build` writes `apps/cli/dist/anchor.mjs`, the same single file the npm
  package ships (`node apps/cli/dist/anchor.mjs --help`).
- `pnpm --filter ./apps/cli dev <args>` runs the TypeScript source with `tsx` (development).

In CI, use the [setup action](/anchor/guides/ci/).

## Upgrade and uninstall

Upgrade with the tool you installed with. `anchor --version` shows what you have.

| Installed with | Upgrade | Uninstall |
|----------------|---------|-----------|
| npm | `npm install -g @anchor-secrets/cli@latest` | `npm uninstall -g @anchor-secrets/cli` |
| Homebrew | `brew update && brew upgrade anchor` | `brew uninstall anchor` |
| Install script | run the script again (`ANCHOR_VERSION` pins a version) | `rm ~/.local/bin/anchor ~/.local/bin/anchor-secrets` |
| Release binary | download the new binary over the old one | delete the binary |
| Setup action | bump `sotarak/anchor/setup-action@v<version>` | remove the step |

Before you uninstall, run `anchor logout`: it revokes the session on the server and removes the
stored credential from the keychain (or the fallback file). Uninstalling alone leaves both behind.
The install script uses `ANCHOR_INSTALL_DIR` in place of `~/.local/bin` if you set it.

## Getting started

```sh
anchor login --api-url https://anchor.example.com   # approve in the browser
cd my-app
anchor init                                          # pick a project and default environment
anchor secrets set DATABASE_URL                      # hidden prompt for the value
anchor run -- npm start                              # npm start sees DATABASE_URL
```

`anchor login` stores a CLI session (valid 30 days) in your OS keychain and remembers the API URL in
your user config. `anchor init` writes `.anchor.json`, which is meant to be committed.

### Logging in

`anchor login` logs in through the browser, like `gh auth login`:

1. It prints `Open https://<server>/cli/login?code=WDJB-MJHT and confirm the code WDJB-MJHT` and,
   in a terminal, opens that page (`--no-browser` only prints it).
2. On the page, signed in to the dashboard, check that the code matches and click **Approve**.
3. The CLI, which polls every 5 seconds, stores the session. The request expires after 10 minutes.

It works over SSH and in containers: open the URL on any device. Only a dashboard session can
approve a request. `Login was denied in the browser` and
`Login request expired; run anchor login again` exit with code 3. Against a server older than
0.4.0 it says `This server does not support browser login; use anchor login --with-password`.

`anchor login --with-password` keeps the email and password flow; `--email` and
`--password-stdin` imply it, so existing scripts keep working. CI should use `ANCHOR_TOKEN`.

## Commands

Run `anchor <command> --help` for the options and examples of each command.

`get`, `run` and `export` expand [references](/anchor/guides/references-imports/) and include the
folder's imports by default; `--no-expand` uses the stored values. History and rollback are
described in [Versions and rollback](/anchor/guides/versions/).

| Command | Purpose |
|---------|---------|
| `anchor login [--no-browser] [--with-password] [--email <email>] [--password-stdin]` | Log in (in the browser by default) and store a CLI session |
| `anchor logout` | Revoke the stored session on the server and delete it locally |
| `anchor whoami` | Show the current user or service token |
| `anchor init` | Link the current directory to a project (writes `.anchor.json`) |
| `anchor projects list` | List the projects you can access |
| `anchor envs list` | List the environments of the current project |
| `anchor secrets list [--reveal]` | List secrets with their type and metadata (sensitive values only with `--reveal`) |
| `anchor secrets get <key> [--reveal] [--no-expand] [--at-version <n>]` | Print one secret; a sensitive value is masked in a terminal unless `--reveal` |
| `anchor secrets history <key>` | List the versions of a secret (no values) |
| `anchor secrets rollback <key> --to <n>` | Restore a past version as a new version |
| `anchor secrets set <key> [--from-file <path>] [--comment <text>] [--type <type>] [--sensitive \| --no-sensitive]` | Create or update a secret |
| `anchor secrets import [--from-file <path>] [--format dotenv\|json\|yaml] [--overwrite] [--non-sensitive <glob>]... [--comment <text>] [--dry-run]` | Import a dotenv, JSON or YAML file into the current environment and path |
| `anchor secrets delete <key>` | Delete a secret |
| `anchor folders list` | List the subfolders of `--path` (default `/`) |
| `anchor folders create <path>` | Create a folder and its parents (no-op if it exists) |
| `anchor folders delete <path> [--force]` | Delete an empty folder; `--force` deletes its contents too |
| `anchor run [--no-override] [--no-expand] [--watch [--watch-interval <s>]] -- <command> [args...]` | Run a command with secrets in its environment |
| `anchor export [--format dotenv\|json\|yaml] [--output <file>] [--no-expand]` | Write secrets to a file or a pipe |
| `anchor tokens create --name <name> [--scope <env[:path]>]... [--permission read\|read-write] [--expires-in <days\|never>]` | Create a service token (`never`: valid until revoked) |
| `anchor tokens list` | List the project's service tokens |
| `anchor tokens revoke <id>` | Revoke a service token |

### Value types and plain config

Every secret has a type: `string` (the default), `json`, `pem`, `number`, `boolean` or `list` (a
JSON array of strings), and is either sensitive (the default) or plain config:

```sh
printf 8080 | anchor secrets set APP_PORT --type number --no-sensitive
anchor secrets set JWT_KEYS --from-file keys.json --type json
anchor secrets set TLS_CERT --from-file cert.pem --type pem
```

- `set` checks the value against its type before sending it, and fails with
  `Value of <KEY> is not valid for type <type>: <reason>` (exit 2) without printing the value.
  Without `--type` or `--sensitive`/`--no-sensitive`, the secret keeps its current type and flag
  (a new secret is a sensitive `string`).
- `secrets list` has a TYPE column. Non-sensitive values are shown without `--reveal`; sensitive
  ones show `********` unless you pass `--reveal`. `secrets get` prints a non-sensitive value
  without `--reveal` too.
- References (`${...}`) expand only in `string` values; typed values are always used as stored.

### Import a file

`anchor secrets import` loads a whole file into one environment and folder (`--env`, `--path`, or
`.anchor.json`), so a service can move to `anchor run` without one `secrets set` per key.

- **Format** comes from `--format`, otherwise from the name: `.json` is JSON, `.yaml`/`.yml` is
  YAML, and `.env`, `*.env` or a name starting with `.env` (`.env.production`) is dotenv. Piped
  stdin, or any other name, needs `--format`.
- **dotenv** values are imported as `string`, byte for byte; nothing is guessed.
- **JSON and YAML** must hold an object. Nested keys are joined with `_` and uppercased, with `-`,
  `.` and spaces turned into `_`: `configs.openrouter.api_key` becomes
  `CONFIGS_OPENROUTER_API_KEY` and `transporters.grpc-clients` becomes
  `TRANSPORTERS_GRPC_CLIENTS`. Types are inferred: numbers are `number` and keep the text written
  in the file (`1.0` stays `1.0`; a YAML number such as `0x1F` or `.inf` is imported as a `string`),
  `true`/`false` are `boolean`, an array of strings is `list`, any other array is `json`, a PEM block is `pem`, and
  other strings are `string`. A blank value (`api_key:`) or an empty object is reported as
  **empty** and nothing is created for it.
- **Before anything is sent**, the whole file is checked; a key that is not a valid Anchor key
  (`Cannot import 2fa: 2FA is not a valid key`), two paths that map to the same key
  (`a.b-c and a.b_c both become A_B_C`), or a value over 64 KiB or invalid for its type stops the
  import with exit 2. Every problem is listed at once, and values are never printed.
- **Existing keys** are skipped and listed as `skip`. `--overwrite` writes a new version for them
  with the imported type and flag (a key whose value, type, flag and comment are already the same
  is reported as unchanged). Without `--comment`, an overwritten key keeps its comment.
- **Sensitivity:** every key is sensitive unless it matches a `--non-sensitive <glob>` (`*` and
  `?`, case-sensitive, matched against the final key; repeat the flag for more globs).
- **Writes** go one at a time, in key order. On the first failure the import stops with exit 1 and
  `Imported <n> of <m>; <KEY> failed: <error>. Re-run to continue`; a re-run skips the keys already
  written.
- **Output** is a KEY, TYPE, SENSITIVE and ACTION table, then
  `Created <a>, updated <b>, skipped <c> existing, <d> empty in <env>:<path>`. `--dry-run` prints
  the same table with `Dry run: would create ...` and writes nothing. Values are never shown.

For example, moving zepo-engine's shared config and one service's `.env` into `prod`:

```sh
anchor secrets import --from-file application.config.yaml --env prod --path /shared \
  --non-sensitive 'CONFIGS_CONTEXT_*' --non-sensitive 'CONFIGS_AGENT_*' --dry-run
# check the plan, then run it again without --dry-run
anchor secrets import --from-file apps/service-agent/.env --env prod --path /service-agent
```

Then replace each value in `application.config.yaml` with its placeholder
(`api_key: ${CONFIGS_OPENROUTER_API_KEY}`) and start the service with `anchor run`.

### Handling of secret values

- Values are never accepted as command-line arguments. `anchor secrets set KEY=value` and any
  `--value` flag are rejected (exit 2) without echoing the value. `set` reads the value from
  `--from-file` (exact bytes), from piped stdin (one trailing newline removed), or from a hidden
  prompt. Any second positional or `=` after `secrets set` (also after `--`) is rejected the same
  way. An empty stdin exits 2 so `</dev/null` cannot blank a secret; set an empty value with
  `--from-file` and an empty file.
- `secrets get` prints the raw value (no added newline) when stdout is a pipe or a file. In a
  terminal it shows a sensitive value masked unless you pass `--reveal`; a masked view does not read the
  value from the server, so it is not recorded as a secret read.
- `anchor run` fetches secrets before starting the command. If the fetch fails (network error,
  expired session, missing permission) the command is **not** started. `SIGTERM` and `SIGHUP` are
  forwarded to the command; `SIGINT` is forwarded only when there is no terminal (at a terminal,
  Ctrl-C already reaches the command, and a second one would force-quit many tools). `anchor`
  exits with the command's exit code (127 when the command is not found, 128 + N when it was
  killed by signal N). By default Anchor values replace existing environment variables;
  `--no-override` keeps existing ones. The command must follow `--` (exit 2 otherwise, so a
  child's `--env prod` is never read as Anchor's); everything after `--` is passed unchanged. On
  Windows, `.cmd` shims such as `npm` are resolved through `PATHEXT`.
- `anchor export` refuses to print to a terminal. With `--output` it writes the file with mode 0600
  (also when it replaces an existing file), asks before overwriting (`--yes` in scripts), and warns
  when the file is not gitignored. `--format dotenv` fails with a hint when a value cannot be written
  so that a dotenv parser reads it back exactly (a value that contains both `"` and a newline); use
  `--format json` or `--format yaml` for such values.
- `--format json` and `--format yaml` write typed values: a `number` as a number, a `boolean` as
  `true`/`false`, a `list` as an array and a `json` value as its JSON. `dotenv` and `anchor run`
  always use the stored text (`PORT=8080`, `MODELS=["a","b"]`).
- `--debug` prints one line per request (`debug: GET /api/v1/... -> 200 (12ms)`): never headers,
  bodies, tokens or values.

### Restart on changes: `anchor run --watch`

```sh
anchor run --watch -- npm run dev
anchor run --watch --watch-interval 10 --env staging -- node server.js
```

With `--watch`, `anchor run` keeps checking Anchor while the command runs and restarts the
command when its secrets change:

- The first fetch works as without `--watch`: if it fails, the command is not started.
- Every `--watch-interval` seconds (default 30, minimum 5, a whole number) the CLI asks Anchor
  whether the folder changed, with `If-None-Match`. An unchanged folder costs a `304` with no
  body and no audit row, so watching is cheap.
- When the environment the command would get differs, stderr shows
  `Secrets changed; restarting <command>` (never keys or values). The command gets `SIGTERM`; if
  it has not exited after 10 seconds it gets `SIGKILL`. Then it starts again with the new values.
  Only one copy of the command ever runs. A change that leaves the environment as it was (a
  comment, or a key that `--no-override` hides) does not restart it.
- When a check fails (network error, server error, expired or revoked token), the command keeps
  running with the values it has. The first failure prints
  `Could not check Anchor for changes (<reason>); keeping the current values`, and the first check
  that works again prints `Reconnected to Anchor`.
- When the command exits on its own, `anchor` stops watching and exits with the command's code.
  `SIGINT`, `SIGTERM` and `SIGHUP` reach the command as without `--watch`, so stopping `anchor`
  stops both.
- On Windows, `SIGTERM` ends the command at once: there is no grace period.
- `--watch-interval` without `--watch`, or a value that is not a whole number of at least 5,
  exits 2.

Only secrets are watched; to restart on file changes too, run a file watcher (such as `nodemon`)
under `anchor run --watch`.

### Destructive commands

`secrets delete`, `tokens revoke`, `init` over an existing `.anchor.json` and `export --output` over
an existing file ask for confirmation in a terminal. Without a terminal they require `--yes` and exit
2 otherwise.

## Global flags

| Flag | Meaning |
|------|---------|
| `--json` | Print one JSON document on stdout (see "JSON output") |
| `-q, --quiet` | Suppress progress messages on stderr |
| `--no-color` | Disable colored output |
| `--debug` | Print request diagnostics to stderr (never secret values) |
| `--api-url <url>` | Anchor server URL |
| `--project <slug>` | Project slug |
| `--env <slug>` | Environment slug |
| `--path <path>` | Secret folder path (`/`, `/api`, ...) |
| `-y, --yes` | Skip confirmations |
| `--version`, `-h, --help` | Version and help |

Global flags work before or after the command name. stdout carries data only; progress, prompts,
hints, warnings and errors go to stderr. Color is used only on a terminal, and never when `NO_COLOR`
is set, `TERM=dumb`, or `--no-color` is given.

## Configuration

Precedence, highest first: **flags > `ANCHOR_*` environment variables > `.anchor.json` > user
config > defaults** (`env` = `dev`, `path` = `/`, no default API URL).

### `.anchor.json`

`anchor init` writes it in the current directory; commands find the nearest one by walking up from
the working directory. It holds identifiers only and is safe to commit:

```json
{
  "version": 1,
  "project": "my-app",
  "defaultEnv": "dev",
  "path": "/",
  "apiUrl": "https://anchor.example.com"
}
```

`defaultEnv`, `path` and `apiUrl` are optional (`init` writes `apiUrl` only when you passed
`--api-url`). The CLI refuses a file with unknown keys, and refuses a file that contains any string
starting with `anc_` (a token): remove it and rotate the token.

### User config

`$XDG_CONFIG_HOME/anchor/config.json`, else `~/.config/anchor/config.json` (macOS, Linux), or
`%APPDATA%\anchor\config.json` (Windows). It holds `{ "apiUrl": "..." }`, written by the first
`anchor login`.

### API URL

The URL is reduced to its origin. `https://` is required, except for `localhost`, `127.0.0.1` and
`[::1]`. `anchor login` always prints the server it is logging in to. When the URL comes only from
`.anchor.json` and differs from your user config, it warns and asks before logging in
(`Log in to <url>?`, or `Send your password to <url>?` with `--with-password`; without a terminal it
exits 2 unless you pass `--api-url` or `--yes`), and it never saves that URL as your user config.

### Environment variables

| Variable | Meaning |
|----------|---------|
| `ANCHOR_API_URL` | API URL |
| `ANCHOR_PROJECT`, `ANCHOR_ENV`, `ANCHOR_PATH` | Project, environment and path |
| `ANCHOR_TOKEN` | Service token for CI; takes precedence over a stored login |
| `ANCHOR_CREDENTIAL_STORE` | `auto` (default) or `file` |
| `NO_COLOR` | Disable color |
| `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` | Proxy settings (see "Proxy") |

`ANCHOR_TOKEN` is only sent to an API URL that comes from `--api-url`, `ANCHOR_API_URL` or your
user config. If the only API URL is the one in `.anchor.json`, the CLI exits 2: a pull request
cannot redirect your CI token to another host. Set `ANCHOR_API_URL` in CI.

## Credential storage

| Platform | Store |
|----------|-------|
| macOS | Login keychain (service `anchor-cli`, account = API origin), written through `security -i` on stdin |
| Linux with a desktop session | Secret Service (GNOME Keyring, KWallet) through `secret-tool`, token on stdin |
| Everything else, or `ANCHOR_CREDENTIAL_STORE=file` | `<user config dir>/credentials.json`, mode 0600 in a 0700 directory |

Tokens never appear in process arguments. When the keychain cannot be written, the CLI falls back to
the file and warns. The CLI refuses to read a credentials file that other users can access (run
`chmod 600` on it). `anchor logout` revokes the session on the server, then deletes it locally; if
the server cannot be reached it still deletes the local copy, exits 1 and tells you until when the
session stays valid.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error |
| `2` | Usage error (bad flag or argument, missing `--yes` without a terminal, refused configuration) |
| `3` | Not logged in, session expired or revoked, invalid credentials or token |
| `4` | Forbidden |
| `5` | Not found |
| `6` | Conflict |

`anchor run` exits with the command's own code instead (127: not found; 128 + N: killed by signal
N). These codes are a stable contract.

## JSON output

With `--json`, stdout holds exactly one JSON document. Fields may be added in later versions;
existing fields are not renamed or removed without a major version.

| Command | Shape |
|---------|-------|
| `login` | `{ apiUrl, user, expiresAt, credentialStore }` (never the token) |
| `logout` | `{ loggedOut, revoked }` |
| `whoami` | `{ apiUrl, type: "user", user }` or `{ apiUrl, type: "service_token", serviceToken }` |
| `init` | `{ projectFile, project, defaultEnv }` |
| `projects list` | `{ projects: ProjectDto[] }` |
| `envs list` | `{ environments: EnvironmentDto[] }` |
| `secrets list` | `{ secrets: SecretDto[] }` (`value` with `--reveal`, and for non-sensitive secrets) |
| `secrets get` | `{ secret: SecretDto }` (`value` only with `--reveal` or when stdout is not a terminal) |
| `secrets set` | `{ secret: SecretDto, created: boolean }` (never the value) |
| `secrets delete` | `{ deleted: { key, environment, path } }` |
| `secrets import` | `{ created, updated, unchanged, skipped, empty }` (arrays of keys; `empty` holds source paths; `dryRun: true` with `--dry-run`, where the arrays hold the planned keys) |
| `export --output` | `{ path, count, format }` (without `--output`, use `--format json` instead of `--json`) |
| `tokens create` | `{ serviceToken: ServiceTokenDto, token }` |
| `tokens list` | `{ serviceTokens: ServiceTokenDto[] }` |
| `tokens revoke` | `{ revoked: id }` |

The DTO types are defined in `packages/shared/src/api.ts`. Errors are not JSON: they go to stderr
as `error: <message>` and `hint: <next step>`.

## Network behavior

Each request times out after 15 seconds. `GET` and `PUT` (secret writes are idempotent) are retried
at most twice, after 250 ms and 1 s, on network errors and on HTTP 429, 502, 503 and 504. `POST` and
`DELETE` are never retried.

### Proxy

The CLI honors `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` (lowercase variants too). On Node it routes
requests through undici's `EnvHttpProxyAgent` when one of these is set. The Bun release binaries use
Bun's own proxy support for the same variables.

## CI

CI jobs authenticate with a service token in `ANCHOR_TOKEN`; see [Use Anchor in CI](/anchor/guides/ci/).

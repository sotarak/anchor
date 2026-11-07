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
anchor login --api-url https://anchor.example.com   # email + hidden password prompt
cd my-app
anchor init                                          # pick a project and default environment
anchor secrets set DATABASE_URL                      # hidden prompt for the value
anchor run -- npm start                              # npm start sees DATABASE_URL
```

`anchor login` stores a CLI session (valid 30 days) in your OS keychain and remembers the API URL in
your user config. `anchor init` writes `.anchor.json`, which is meant to be committed.

## Commands

Run `anchor <command> --help` for the options and examples of each command.

`get`, `run` and `export` expand [references](/anchor/guides/references-imports/) and include the
folder's imports by default; `--no-expand` uses the stored values. History and rollback are
described in [Versions and rollback](/anchor/guides/versions/).

| Command | Purpose |
|---------|---------|
| `anchor login [--email <email>] [--password-stdin]` | Log in and store a CLI session |
| `anchor logout` | Revoke the stored session on the server and delete it locally |
| `anchor whoami` | Show the current user or service token |
| `anchor init` | Link the current directory to a project (writes `.anchor.json`) |
| `anchor projects list` | List the projects you can access |
| `anchor envs list` | List the environments of the current project |
| `anchor secrets list [--reveal]` | List secret names and metadata (values only with `--reveal`) |
| `anchor secrets get <key> [--reveal] [--no-expand] [--at-version <n>]` | Print one secret; masked in a terminal unless `--reveal` |
| `anchor secrets history <key>` | List the versions of a secret (no values) |
| `anchor secrets rollback <key> --to <n>` | Restore a past version as a new version |
| `anchor secrets set <key> [--from-file <path>] [--comment <text>]` | Create or update a secret |
| `anchor secrets delete <key>` | Delete a secret |
| `anchor folders list` | List the subfolders of `--path` (default `/`) |
| `anchor folders create <path>` | Create a folder and its parents (no-op if it exists) |
| `anchor folders delete <path> [--force]` | Delete an empty folder; `--force` deletes its contents too |
| `anchor run [--no-override] [--no-expand] -- <command> [args...]` | Run a command with secrets in its environment |
| `anchor export [--format dotenv\|json\|yaml] [--output <file>] [--no-expand]` | Write secrets to a file or a pipe |
| `anchor tokens create --name <name> [--scope <env[:path]>]... [--permission read\|read-write] [--expires-in <days>]` | Create a service token |
| `anchor tokens list` | List the project's service tokens |
| `anchor tokens revoke <id>` | Revoke a service token |

### Handling of secret values

- Values are never accepted as command-line arguments. `anchor secrets set KEY=value` and any
  `--value` flag are rejected (exit 2) without echoing the value. `set` reads the value from
  `--from-file` (exact bytes), from piped stdin (one trailing newline removed), or from a hidden
  prompt. Any second positional or `=` after `secrets set` (also after `--`) is rejected the same
  way. An empty stdin exits 2 so `</dev/null` cannot blank a secret; set an empty value with
  `--from-file` and an empty file.
- `secrets get` prints the raw value (no added newline) when stdout is a pipe or a file. In a
  terminal it shows the value masked unless you pass `--reveal`; a masked view does not read the
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
- `--debug` prints one line per request (`debug: GET /api/v1/... -> 200 (12ms)`): never headers,
  bodies, tokens or values.

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
`.anchor.json` and differs from your user config, it warns and asks before sending your password
(without a terminal it exits 2 unless you pass `--api-url` or `--yes`), and it never saves that URL
as your user config.

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
| `secrets list` | `{ secrets: SecretDto[] }` (`value` only with `--reveal`) |
| `secrets get` | `{ secret: SecretDto }` (`value` only with `--reveal` or when stdout is not a terminal) |
| `secrets set` | `{ secret: SecretDto, created: boolean }` (never the value) |
| `secrets delete` | `{ deleted: { key, environment, path } }` |
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

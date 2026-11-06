---
name: building-cli
description: Use when designing, implementing, or reviewing commands, flags, output, auth, config files, or distribution of the Anchor CLI (the developer-facing command-line client for the secrets/config service) — including `run`-style env injection, login flows, and CI usage.
---

# Building the Anchor CLI

## Overview

The CLI is the main way developers and CI pipelines touch secrets, so it carries two jobs at once:
a good CLI (predictable, scriptable, well-documented) and a security boundary (it handles plaintext
secrets on user machines). When those conflict, **security wins, then scriptability, then convenience**.

Baseline guidance: [Command Line Interface Guidelines](https://clig.dev). Verify library APIs against
the versions installed in the repo; do not write framework code from memory.

## When to use

- Adding or changing a command, subcommand, flag, or output format
- Implementing login/logout, token storage, or project linking
- Implementing `run` (inject secrets into a child process) or `export`/`pull`
- Reviewing CLI code or help text
- Packaging, releasing, or versioning the CLI

## Command design

- **Structure:** `anchor <noun> <verb>` for resources (`anchor secrets set`, `anchor envs list`), plus
  a few top-level verbs for hot paths (`anchor login`, `anchor run`, `anchor init`). Keep it consistent.
- **Flags over positionals** except for the obvious primary argument (`anchor secrets get DB_URL`).
  Every flag has a long form; short forms only for very common ones.
- **Standard flags everywhere:** `-h/--help`, `--version`, `--json`, `-q/--quiet`, `--no-color`,
  `--project`, `--env`, `-y/--yes` (skip confirmations), `--debug` (to stderr, never prints secret values).
- **Destructive operations** (delete, overwrite, rotate) confirm interactively; in non-TTY they require
  `--yes` and fail otherwise. Offer `--dry-run` where it is cheap.
- **Idempotent where possible:** `set` on an identical value is a no-op success, not an error.

## Output

- **stdout = data, stderr = everything else** (progress, hints, warnings, prompts). Piping `--json`
  output must yield valid JSON only.
- Detect TTY: colors, spinners, and tables only when stdout is a TTY. Respect `NO_COLOR` and `TERM=dumb`.
- `--json` output is a public, versioned contract. Add fields freely; never rename or remove without a
  major version bump.
- **Exit codes:** `0` success, `1` generic failure, `2` usage error. Define and document a small set of
  specific codes (for example auth required, not found, permission denied) and keep them stable.
- Errors say what happened, why, and what to do next (`Run 'anchor login' first`). No stack traces
  unless `--debug`.

## Handling secrets safely (non-negotiable)

| Rule | Why |
|------|-----|
| Never accept secret **values** as argv. Read from stdin, `--from-file`, or a hidden prompt | argv is visible in `ps`, shell history, CI logs |
| Never print secret values by default. `list` shows names and metadata; `get` requires an explicit `--reveal`/`--plain` or a non-TTY pipe | Shoulder-surfing, terminal scrollback, screen-share |
| `run -- <cmd>` injects env into the child only. Do not write plaintext to disk | Files persist and get committed |
| `export`/`pull` to a file writes with mode `0600` and warns if the target is not gitignored | Accidental commits |
| Redact values in `--debug` and in error messages | Logs get shared in bug reports |
| Zero/clear buffers where the runtime allows; do not keep decrypted secrets in long-lived caches | Reduces exposure in memory dumps |

### `anchor run -- <cmd>` semantics

- Fetch secrets, merge into the parent environment (precedence documented: by default Anchor values
  override existing env; offer a flag to invert), then spawn the child with inherited stdio.
- Forward signals (SIGINT, SIGTERM, SIGHUP) to the child and **exit with the child's exit code**.
- Fail closed: if fetching secrets fails, do not run the command with partial env, unless the user
  explicitly opts into a documented offline/cached mode.
- Support `--watch`/reload only after the basic semantics are solid and tested.

## Auth and credentials

- **Interactive login:** OAuth 2.0 Device Authorization Grant (RFC 8628) or browser loopback with PKCE
  (RFC 8252). Never ask users to paste long-lived tokens into prompts as the primary flow.
- **CI / machine identities:** read a scoped token from an env var (`ANCHOR_TOKEN`) or a
  file. Tokens are scoped to project + environment + permissions and have an expiry.
- **Storage:** OS keychain first (macOS Keychain, Windows Credential Manager, libsecret). Fallback to a
  config-dir file with mode `0600`, and warn. Never store tokens in the project directory.
- Refresh tokens transparently; on refresh failure, give a single clear "run `anchor login`" error.
- `anchor logout` revokes server-side, not just deletes locally.

## Configuration precedence

`flags > env vars (ANCHOR_*) > project file (.anchor.json, committed, no secrets) > user config
(XDG config dir / %APPDATA%) > defaults`.

The project file holds only identifiers (project id, default env, API URL). The CLI must refuse to
read secrets from it.

## Implementation guidance

- Keep command handlers thin: parse args, call a pure core function, render output. Core functions take
  an injected API client and I/O streams so tests do not need a real terminal or network.
- Share API types and validation schemas with the Worker (same TypeScript package) so client and
  server cannot drift. If the stack is not decided yet, raise it during brainstorming rather than
  picking silently.
- Single source of truth for help text: generated from the command definitions, with at least one
  example per command.
- Network: timeouts on every request, limited retries with backoff for idempotent calls only, clear
  message on TLS or proxy errors. Honor `HTTPS_PROXY`.
- Version check / update notice: opt-out via env var, never blocks, never in non-TTY.

## Testing

Follow `test-driven-development`. Minimum coverage per command:

- Handler logic with a fake API client (success, auth error, not found, permission denied, network error)
- Non-TTY behavior: no colors/prompts, `--yes` required for destructive ops, `--json` validity
- Snapshot of `--help` output (catches accidental flag/UX changes)
- `run`: exit code propagation, signal forwarding, fail-closed on fetch error, values never echoed
- End-to-end against a local Worker (`wrangler dev` / `cf dev`, or the Workers Vitest pool) for login,
  set/get, and `run`

## New-command checklist

- [ ] Name follows `noun verb`; flags match existing conventions
- [ ] `--help` has description + example; `--json` output defined
- [ ] Secret values never in argv, never printed by default, redacted in debug
- [ ] Destructive → confirmation + `--yes`; non-TTY tested
- [ ] Exit codes documented; errors actionable
- [ ] Tests written first and passing; help snapshot updated

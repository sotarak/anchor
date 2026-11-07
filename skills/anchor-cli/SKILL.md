---
name: anchor-cli
description: Use when a project has an .anchor.json file or uses the anchor CLI, when an app fails because an environment variable or secret is missing, or when someone asks to read, add, change, compare or export secrets or configuration kept in Anchor, or to log in to Anchor.
---

# Using the Anchor CLI

## Overview

Anchor is a self-hosted secrets manager; `anchor` is its CLI. Projects hold environments
(`dev`, `prod`, ...), environments hold folders (`/`, `/api`), folders hold secrets.

**Core rule: secret values and passwords never pass through you.** You work with keys, types and
metadata. Values go from Anchor straight into the app (`anchor run`), or from the person straight
into Anchor (a hidden prompt they answer). Nothing you type, run or print contains one.

**Violating the letter of this rule is violating its spirit.** A value inside a `printf`, a
heredoc, an `echo`, a temp file or a quoted argument is a value you typed.

## Before anything

1. `anchor whoami` — signed in? If it says "Not logged in", go to **Logging in**.
2. Read `.anchor.json` (project, default environment, API URL; it holds no secrets). Target
   another environment or folder with `--env prod` / `--path /api` on each command; do not edit
   `.anchor.json` for a one-off.
3. Full command list: [references/commands.md](references/commands.md).

## Quick reference

| Task | Do |
|---|---|
| App needs its secrets / "X is not set" | `anchor run -- npm start` (any command after `--`) |
| See what exists | `anchor secrets list` (sensitive values stay hidden) |
| Compare environments | `anchor secrets list --env prod --json` vs `--env staging --json`: keys, types, versions |
| Add or change a value the person has | Give them `anchor secrets set KEY [--env prod]` to run; it prompts with hidden input |
| Value is in a file they already have | `anchor secrets set KEY --from-file path/to/file` |
| Plain config (port, host, flag) | `printf 8080 \| anchor secrets set PORT --type number --no-sensitive` |
| A tool insists on a dotenv file | `anchor export --output .env.local`, only after `git check-ignore -q .env.local` succeeds |
| Not logged in | Ask the person to run `anchor login` (browser approval) |

## Running the app

`anchor run -- <command>` injects the folder's secrets as environment variables, expands
`${KEY}` references, passes the exit code through and writes nothing to disk. Use it for start
scripts, tests, migrations and one-off scripts. Do not "fix" a missing variable by exporting
secrets to `.env`, copying values into a config file, or setting them inline.

## Reading

- `anchor secrets list` shows keys, types, versions, comments and the values of
  **non-sensitive** keys. That answers "what's in prod" and "how do prod and staging differ".
- Do not run `--reveal` (`secrets list --reveal`, `secrets get KEY --reveal`), `anchor export`
  to stdout, or `secrets get` piped anywhere you can see. Each reveal is audited, and the value
  would enter your context and the conversation logs.
- If the person needs a sensitive value, give them the command to run in their own terminal:
  `anchor secrets get KEY --env prod --reveal`.

## Writing

The CLI never takes a value as an argument. Pick the source:

1. **The person knows or holds the value** (including one they pasted into the chat): tell them
   to run `anchor secrets set KEY --env <env>` themselves (add `--type`, `--no-sensitive` or
   `--comment` as needed); it prompts with hidden input. If they pasted it into the chat, say once
   that it is now in the chat history and that rotating it is safest.
2. **The value is in a file** (a PEM key, a JSON credential): `--from-file <path>` (`--type pem`
   or `--type json`).
3. **Non-sensitive config you are allowed to see** (a port, a hostname, a feature flag):
   `printf '%s' 'value' | anchor secrets set KEY --no-sensitive [--type number|boolean|json|list]`.

New secrets are sensitive by default; `--no-sensitive` is only for values that are fine to show
anyone with read access. `--type` (`string`, `json`, `pem`, `number`, `boolean`, `list`) is
checked before sending. Confirm a write with `anchor secrets list` or `secrets history KEY`, never
by reading the value back. Deleting or rolling back asks for confirmation; pass `--yes` only when
the person asked for that exact change.

## Logging in

Never sign in for the person and never handle their password. Ask them to run `anchor login`
(add `--no-browser` on a remote machine); they approve the code on the Anchor dashboard. Do not
use `--with-password`, `--email` or `--password-stdin` with a password from the chat. If they sent
a password, do not use it; suggest changing it, since it is now in the chat history. CI and
servers use a service token in `ANCHOR_TOKEN` instead (see the anchor-ci skill).

## Rationalizations

| Excuse | Reality |
|---|---|
| "Piping through stdin keeps it out of `ps`" | The command text is still in your transcript, tool logs and shell history. The value is in the command you wrote. |
| "The value is already in the chat, one more copy changes nothing" | Each command adds copies in more logs, with a key name attached. Hand the person the prompt instead. |
| "They asked me to do it quickly / they're busy" | Running `anchor secrets set KEY` themselves takes ten seconds; leaked keys take days. |
| "If stdin doesn't work I'll pass it as an argument" | `set` takes stdin, a prompt or a file; never an argument. |
| "`--password-stdin` is the non-interactive way" | It exists for the person's own scripts. You use `anchor login` and the person approves. |
| "They want to see everything" | `secrets list` is everything you show. Values stay with the person. |
| "I'll export to .env just to unblock them" | `anchor run -- <cmd>` unblocks them without a file. |

## Red flags — stop

- A secret value or password appears anywhere in a command you are about to run
- You are about to add `--reveal`, or run `anchor export` without `--output` to a gitignored file
- You are writing secret values into `.env`, a config file or a script
- You are about to log in on the person's behalf

**Any of these: stop, and give the person the command to run themselves.**

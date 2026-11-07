---
title: Agent skills
description: Teach Claude Code, Codex and other AI coding agents to use Anchor safely in your projects.
sidebar:
  order: 9
---

Anchor ships three [agent skills](https://agentskills.io): short instructions an AI coding agent
loads when a task needs them. With them installed, an agent in a project that uses Anchor runs
your app with `anchor run` instead of writing a `.env`, never puts a secret value or a password
into a command, migrates config files with a dry run first, and gives CI a narrow token.

## Install

In the project where your agent works:

```sh
npx skills add sotarak/anchor --skill anchor-cli --skill anchor-migrate --skill anchor-ci
```

The [`skills`](https://www.npmjs.com/package/skills) CLI asks which agents to install for (Claude
Code, Codex, Cursor and others) and whether to install for this project or for your user. Add
`-g` for every project, `-a claude-code` to pick the agent, or `-y` to accept the defaults.

Name the three skills: the Anchor repository also holds the skills its own contributors use, and
`npx skills add sotarak/anchor --list` shows those too.

## What each skill does

| Skill | The agent uses it when | It makes the agent |
|---|---|---|
| `anchor-cli` | A project has `.anchor.json`, an app is missing a variable, or you ask about secrets | Run apps with `anchor run`, read keys and metadata without `--reveal`, hand you `anchor secrets set KEY` to type a value into a hidden prompt, ask you to run `anchor login` instead of using a password, export only to gitignored files |
| `anchor-migrate` | Moving `.env`, YAML or JSON config into Anchor | Map services to folders (with a shared folder imported into each), dry-run every `secrets import`, mark plain config with `--non-sensitive`, use `${KEY}` placeholders only where the config loader expands them, switch start scripts to `anchor run`, and delete the old files only after you confirm |
| `anchor-ci` | A pipeline, deploy job or server needs secrets | Create a read token scoped to the folders the job reads and pipe it straight into the CI secret, set `ANCHOR_API_URL` next to `ANCHOR_TOKEN`, pin the CLI (setup action, install script or `npx`), and explain the trade-off of `--expires-in never` |

Every skill keeps secret values out of the agent's context: values travel from Anchor into your
app, or from you into Anchor, never through the conversation. If an agent needs a sensitive value,
it gives you the command to run in your own terminal.

For an agent that should read and change secrets directly, with your approval, see
[Connect AI agents over MCP](/anchor/guides/mcp/).

## Update or remove

```sh
npx skills update                 # update installed skills to the latest version
npx skills remove anchor-cli      # remove one
```

---
title: Connect AI agents over MCP
description: Let Claude Code, Codex and other MCP clients read and change secrets, with your approval.
sidebar:
  order: 7
---

Anchor is a remote [MCP](https://modelcontextprotocol.io) server. An AI coding agent connected to
it can see which projects, environments and secrets exist, read non-sensitive configuration, and
create, change or delete secrets. It reads a **sensitive** value only if you allowed that when you
connected it, and every such read is in the audit log.

The agent signs in with OAuth: the first time it connects, your browser opens Anchor, you approve
it, and the agent gets a token that acts as you. Your project roles still apply, so an agent of a
project viewer cannot write.

The server URL is your instance's address plus `/mcp`, for example `https://anchor.example.com/mcp`.

## Claude Code

```sh
claude mcp add --transport http anchor https://anchor.example.com/mcp
```

Then run `/mcp` inside Claude Code, choose **anchor** and sign in. Your browser opens the Anchor
approval page.

## Codex

```sh
codex mcp add anchor --url https://anchor.example.com/mcp
codex mcp login anchor
```

`codex mcp login` opens the approval page in your browser.

## Other clients

Any MCP client that supports Streamable HTTP and OAuth works. It discovers the authorization
server from `https://<server>/.well-known/oauth-protected-resource/mcp`, registers itself, and opens
`/oauth/authorize` in your browser.

## What you approve

The approval page names the app and the address it returns to, and lists what it will be able to
do. Only approve if you just connected an AI agent or app to Anchor.

| Permission | What it allows |
|---|---|
| `secrets:read` | List projects, environments, folders and secrets (keys, types, versions, comments), read **non-sensitive** values, and see a secret's history without values |
| `secrets:write` | Create, update and delete secrets |
| `secrets:reveal` | Read **sensitive** values with `get_secret` and `reveal: true` |

Agents get `secrets:read` and `secrets:write` unless they ask for less. `secrets:reveal` is granted
only if the agent asks for it **and** you tick **Also allow reading sensitive values**. Leave it
unticked unless the agent needs secret values: a value an agent reads enters the AI model's context
and may be kept in the AI provider's logs. Without it, the agent can still run your app through
`anchor run`, which injects values without showing them.

Non-sensitive values are returned as stored: a reference such as `${DB_PASSWORD}` inside one is
not expanded, so it cannot leak the password. A revealed value is expanded.

## Tools

| Tool | Needs | Does |
|---|---|---|
| `list_projects` | read | Projects you can access, with your role |
| `list_environments` | read | A project's environments you can read |
| `list_folders` | read | Subfolders of a folder |
| `list_secrets` | read | Secrets of a folder; values of non-sensitive ones |
| `get_secret` | read (+ reveal) | One secret; a sensitive value only with `reveal: true` |
| `secret_history` | read | Versions of a secret, without values |
| `set_secret` | write | Create or update a secret (`value`, `type`, `sensitive`, `comment`) |
| `delete_secret` | write | Delete a secret |

A tool that needs a permission the agent was not given answers, for example, "This needs the
secrets:reveal permission. Remove and reconnect the Anchor MCP server, and tick "Also allow
reading sensitive values"." To change permissions, remove the server in your agent, add it again
and approve again.

## Audit

Every write and every reveal through MCP is in the project's audit log under your name, with
`via: "mcp"` and the app's client id. Approving, denying and revoking an app are recorded as
`oauth.authorized`, `oauth.denied` and `oauth.revoked`.

## Revoke access

**Account → Connected apps** lists the apps you approved, with their permissions and last use.
**Revoke** cuts an app off at its next request. Access tokens last 1 hour and are refreshed
automatically; a refresh token lasts 30 days, so an agent you stop using loses access after a month
even if you do not revoke it. Disabling your user revokes access for all of your agents.

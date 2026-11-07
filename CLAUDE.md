# Anchor

Anchor is a secrets and configuration manager (in the spirit of Infisical) that runs **entirely on
Cloudflare's developer platform**: Workers for the API and dashboard, plus Cloudflare storage/primitives
(D1, Durable Objects, KV, R2, Queues, ...) chosen per requirement. It ships with a CLI for developers
and CI.

Status: greenfield. No stack decisions are final until recorded in `docs/superpowers/specs/`.

## How we work

- Communicate with the user in Vietnamese; code, comments, commits, and docs in English.
- Project skills live in `.claude/skills/`. The `using-superpowers` skill is injected at session start.
  Follow its workflow: `brainstorming` → `writing-plans` → `executing-plans` /
  `subagent-driven-development`, with `test-driven-development` and `verification-before-completion`.
- Domain skills:
  - `secrets-crypto` — anything touching secret storage, encryption, tokens, authorization, audit
  - `building-cli` — anything touching the CLI
  - `dashboard-ui` — any dashboard screen, component, or style (Novu-like look; tokens + primitive
    recipes). Path-scoped rule in `.claude/rules/dashboard-ui.md`.
  - `cloudflare`, `workers-best-practices`, `wrangler` / `cf-cli`, `durable-objects`,
    `workers-profiling` — platform work. Prefer retrieving current Cloudflare docs over memory.
- The Cloudflare MCP server is configured in `.mcp.json` (docs search + account API).

- Tests live in a layered `test/` tree beside `src/` (`unit/`, `integration/`, `api/`, ... mirroring
  `src/`), with helpers in `test/support/`. Follow `apps/docs/src/content/docs/contributing/testing.md`.

## Hard rules

- Never commit secrets, `.dev.vars`, or real tokens. Never log secret values.
- Security-sensitive changes (crypto, authz, tokens) need tests that prove failure cases, not only
  happy paths.

## Vendored skills

Third-party skills are vendored and pinned; see `.claude/VENDORED.md`. Update them with
`scripts/update-skills.sh` instead of editing in place, so local changes are not lost silently.

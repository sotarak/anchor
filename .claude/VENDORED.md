# Vendored skills

| Skill(s) | Source | Commit | License |
|----------|--------|--------|---------|
| brainstorming, diagnosing-superpowers, dispatching-parallel-agents, executing-plans, finishing-a-development-branch, receiving-code-review, requesting-code-review, subagent-driven-development, systematic-debugging, test-driven-development, using-git-worktrees, using-superpowers, verification-before-completion, writing-plans, writing-skills | [obra/superpowers](https://github.com/obra/superpowers) v7.0.2 | `22f0b463e7a5e579904dd6211a520321035526f7` | MIT © Jesse Vincent |
| cloudflare, workers-best-practices, wrangler, cf-cli, durable-objects, workers-profiling | [cloudflare/skills](https://github.com/cloudflare/skills) | `1f2cd0a19588e2c6197c91dd7c71729df1fb6156` | Apache-2.0 © Cloudflare |

License texts: [obra/superpowers (MIT)](THIRD_PARTY_LICENSES/obra-superpowers-MIT.txt),
[cloudflare/skills (Apache-2.0)](THIRD_PARTY_LICENSES/cloudflare-skills-Apache-2.0.txt),
[novuhq/novu (MIT)](THIRD_PARTY_LICENSES/novu-MIT.txt). The
repository's `NOTICE` lists them as well.

## Local modifications

- Superpowers: the `superpowers:` namespace prefix in cross-references was removed (for example
  `superpowers:writing-plans` → `writing-plans`), because the skills are project-local instead of
  coming from the plugin.
- `.claude/hooks/session-start.sh` is adapted from superpowers `hooks/session-start` to load the
  bootstrap skill from `.claude/skills/`.

## Project-authored skills

`building-cli`, `secrets-crypto`, `dashboard-ui`. These are not vendored and are edited directly.
`dashboard-ui` token values and class recipes are adapted from the open-source Novu dashboard
(`novuhq/novu`, `apps/dashboard`, branch `next`, read 2026-11-06).

## Updating

Run `scripts/update-skills.sh`, review the diff, then update the commit hashes above.

Other Cloudflare skills (agents-sdk, turnstile-spin, cloudflare-email-service, and so on) can be
added by appending them to `CF_SKILLS` in the script.

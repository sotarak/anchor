# Open-source readiness and documentation site — design

Date: 2026-11-07. Status: draft for approval.

## Intent

Anchor is being published as an open-source project. The self-hosted edition is free and has every
feature. An enterprise edition with extra features may come later (open core), but it is out of
scope now. The repository has to read like a real open-source project to a stranger: what Anchor is
and why it exists, how to deploy it on their own Cloudflare account, how to use the CLI and
dashboard, how to contribute, and how to report a vulnerability privately. A documentation site on
GitHub Pages carries the long-form docs.

The GitHub repository `sotarak/anchor` is already public. `main` is visible today, and every commit
lists the author as `Sota <dungla2708@gmail.com>`. A scan of all 104 commits found no real secrets
(only test fixtures and placeholders). `apps/server/wrangler.jsonc` holds a placeholder
`database_id`.

## Goals

1. **License: Apache-2.0** for the whole repository (owner's decision, following the open-core
   plan). It includes a patent grant, and inbound contributions are licensed under Apache-2.0 (§5),
   so the owner can later build a commercial edition on top without a CLA.
2. **Contributions: DCO**, with a `Signed-off-by:` line on every commit of a pull request, enforced
   by a CI check. No CLA.
3. **Community health files** that GitHub recognizes:
   - `LICENSE`, `NOTICE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1),
     `SECURITY.md`, `SUPPORT.md`.
   - Issue forms: bug report, feature request, and a `config.yml` that disables blank issues and
     points security reports to private advisories and questions to Discussions.
   - A pull request template.
   - `CHANGELOG.md` in Keep a Changelog format: an `Unreleased` section that summarizes M1–M5 as
     the first public release.
4. **README rewrite** as the front page:
   - Badges: CI, license, docs.
   - A one-paragraph pitch, and "Why Anchor": everything on your own Cloudflare account, server-side
     envelope encryption, a CLI built for CI.
   - The feature list (kept from the current README), an architecture sketch (Worker + D1 + Queues,
     the key hierarchy), and the shortest path to a running instance with a link to the full guide.
   - Development quickstart, links to the docs site and to CONTRIBUTING, a security note, and the
     license.
   - The developer detail in today's README moves to CONTRIBUTING and the docs site.
5. **Documentation site** with Starlight (Astro), deployed to GitHub Pages at
   `https://sotarak.github.io/anchor/`. It is the single source of the long-form docs.
6. **Package metadata**: every `package.json` gets `"license": "Apache-2.0"`, plus `repository`,
   `homepage` and `bugs` on the root and the CLI. Packages stay `"private": true`: nothing is
   published to npm, and the CLI ships as release binaries.
7. **Copyright and contact** (owner's decisions):
   - The copyright holder is the owner personally: `Copyright 2026 Sota` in `LICENSE` (appendix)
     and `NOTICE`.
   - No email address appears in the community files. Every contact goes through GitHub:
     - Vulnerabilities: private security advisories.
     - Code of conduct reports: the maintainer `@sotarak` on GitHub. GitHub has no direct messages,
       so CODE_OF_CONDUCT.md asks reporters to open an issue titled "Code of conduct: please contact
       me" with no details, and the maintainer follows up privately.
     - Support: Discussions and issues.
8. **Third-party notices** for the vendored agent skills: the MIT text (obra/superpowers) and the
   Apache-2.0 text (cloudflare/skills) are stored next to them, and `NOTICE` mentions them. The
   dashboard design tokens adapted from Novu (MIT) are credited in `NOTICE`.

## Non-goals

- Renaming. The name stays Anchor, the CLI binary stays `anchor`, and the package stays
  `@anchor-secrets/cli`. Docs troubleshooting notes the clash with Solana's `anchor` CLI.
- Publishing to npm, a custom docs domain, versioned docs, a blog, or translations. Starlight's
  i18n keeps a Vietnamese translation possible later.
- Any enterprise-edition structure (`ee/` folder, license keys). Nothing in the code changes for it.
- Rewriting git history to hide the author email (the repository is already public; the owner can
  decide this separately).
- Changing product behavior.

## Anti-goals

- Docs that duplicate each other and drift. Each fact lives in one place: README links to the site,
  and the site does not copy the README.
- Docs that drift from the code. The existing guard (`apps/web/test/unit/deploy/deploy-scripts.test.ts`,
  which checks that the `pnpm <script>` commands in the deploy guide are real root scripts) keeps
  working against the new file location.
- Anything that needs a paid service, a hosted docs platform, or a GitHub App the owner must install
  for the basics to work.
- Committing secrets, `.dev.vars`, or real tokens (standing rule).

## Constraints

- pnpm 12 workspace (`apps/*`, `packages/*`). The pnpm `minimumReleaseAge` policy is never bypassed.
  Starlight's newest release (0.42.10) is one day old, so pin versions that already satisfy the
  policy.
- Docs, code and commits are in English (CLAUDE.md).
- Biome lints the repo. `docs/` and `.claude/` are excluded, and Astro files need whatever the
  builder finds sensible (exclude `apps/docs` generated output at least).
- CI already runs lint, typecheck, build and test, plus web e2e, CLI e2e and Windows jobs. The docs
  build joins CI so a PR cannot break the site.
- GitHub Pages must be set to "GitHub Actions" as its source. Private vulnerability reporting and
  Discussions are repository settings. These are outward-facing changes: the builder documents them
  as owner steps and does not toggle them without the owner's go-ahead.
- Work happens on a new branch cut from `feat/m5-advanced-secrets` (its README and docs describe M5,
  which is not merged yet). It merges after M5.

## Approaches (docs tool)

| Tool | Trade-off | Decision |
|---|---|---|
| **Starlight (Astro)** | Cloudflare's own docs and Biome use it. Built-in static search (Pagefind), dark mode, i18n, near-zero JS. Adds Astro to the toolchain. | **Chosen** (owner accepted the recommendation) |
| VitePress | Vite-based (the repo already uses Vite/Vitest), lightest config. Vue for customization while the dashboard is React; basic search. | Not chosen |
| Docusaurus | React, built-in versioning and blog. Heavy, slow builds; versioning is not needed yet. | Not chosen |

MkDocs Material (adds a Python toolchain) and GitBook (hosted, not GitHub-native) were dropped
early.

## Design

### Repository layout

```
LICENSE  NOTICE  README.md  CHANGELOG.md  CONTRIBUTING.md  CODE_OF_CONDUCT.md  SECURITY.md  SUPPORT.md
.github/
  ISSUE_TEMPLATE/{bug_report.yml, feature_request.yml, config.yml}
  pull_request_template.md
  workflows/{ci.yml (+ docs build), docs.yml (Pages deploy), dco.yml (sign-off check)}
apps/docs/                      # Starlight site, workspace package @anchor/docs (private)
  astro.config.mjs              # site https://sotarak.github.io, base /anchor
  src/content/docs/...          # every long-form page
docs/
  README.md                     # "the docs live at <site>; source in apps/docs"
  superpowers/                  # design specs and plans, unchanged (project history)
.claude/THIRD_PARTY_LICENSES/   # MIT (superpowers), Apache-2.0 (cloudflare/skills)
```

### Site content (sidebar)

- **Start here:** Introduction (what and why), Quickstart (deploy your own instance, condensed),
  Architecture.
- **Guides:**
  - Deploy to Cloudflare (today's `docs/deploy.md` steps 1–8).
  - Dashboard tour.
  - CLI (today's `docs/cli.md`).
  - Using Anchor in CI (the GitHub Actions example).
  - References and imports.
  - Versions and rollback.
- **Operations:** rotating a project key, rotating the root key, audit retention, rate-limiting
  auth, break-glass owner recovery, upgrading (apply migrations, then deploy).
- **Security:** threat model and key hierarchy (from spec §6 and the secrets-crypto rules), what is
  and is not encrypted, audit guarantees, how to report a vulnerability (links to SECURITY.md).
- **Reference:** CLI commands, flags, exit codes, JSON output, environment variables; HTTP API
  overview (routes and auth, from spec §13); limits (references, value size, paths).
- **Contributing:** development setup, test layout (today's `docs/testing.md`), conventions (Biome,
  English, DCO), using the agent skills in `.claude/` (optional for contributors).
- **Troubleshooting:** common errors (config_error, 409 conflicts, CSP), the `anchor` name clash
  with Solana's CLI.

`docs/cli.md`, `docs/deploy.md` and `docs/testing.md` move into the site; they are removed from
`docs/`. Every in-repo pointer to them (`apps/server/wrangler.jsonc`, `.dev.vars.example`,
`src/admin/routes.ts`, CLAUDE.md, the deploy-scripts test) is updated to the new path. The test
reads the new deploy page.

### Workflows

- `docs.yml`: on push to `main` touching `apps/docs/**` (and on manual dispatch), build with pnpm
  and deploy with `actions/upload-pages-artifact` and `actions/deploy-pages`. Permissions:
  `pages: write`, `id-token: write`, and `contents: read`.
- `ci.yml`: add `pnpm --filter @anchor/docs build` to the `check` job. A link validator plugin is
  the builder's call.
- `dco.yml`: on `pull_request`, fail when any commit in the PR lacks a `Signed-off-by:` matching
  its author. No GitHub App. *(Builder's call, recorded here.)*
  - Only commits unique to the PR count (`base.sha..head.sha`).
  - Merge commits and bot authors (`dependabot[bot]`, `github-actions[bot]`) are skipped.
  - History is not rewritten: DCO applies from adoption onward. M5 merges before this lands, so
    its unsigned commits are never in a PR this check sees.
  - Every commit on this branch is made with `git commit -s`.

### Versioning *(builder's call)*

- There are no tags or releases yet. `CHANGELOG.md` holds M1–M5 under `## [Unreleased]`.
- Tagging a first release (`v0.1.0` / `cli-v0.1.0`) is an outward-facing step left to the owner.
  The plan does not tag.

### Sources for new pages *(builder's call)*

- The code is the authority. The design spec is pre-implementation, so where the two disagree, the
  docs follow the code, and known gaps are stated plainly. For example: Anchor has no per-IP rate
  limit yet, so operators should add a WAF rule.
- The dashboard tour is text-only, with no screenshots for now.

### SECURITY.md

- Supported versions: Anchor is pre-1.0. Fixes land on `main` and, once releases exist, in the
  latest release.
- Report through GitHub private vulnerability reporting (Security → Report a vulnerability).
- Response targets, what is in scope (server, dashboard, CLI, crypto design) and safe harbor.
- Enabling private reporting is an owner step (repository setting).

## Left to the builder

- Exact Starlight/Astro versions (within the release-age policy), theme accents matching the
  dashboard brand color, logo/favicon (a simple anchor mark is fine), and page wording.
- Whether to add a link validator, an `.editorconfig`, and Dependabot for GitHub Actions.
- Splitting the large existing pages into the sidebar sections above, without losing content.

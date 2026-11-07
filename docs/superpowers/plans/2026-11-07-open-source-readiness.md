# Open-Source Readiness and First Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Anchor repository a well-formed Apache-2.0 open-source project with a Starlight
documentation site on GitHub Pages, then publish release v0.1.0.

**Architecture:**
- **Community files:** live at the repository root and in `.github/`, and are guarded by a
  repository-hygiene test.
- **Docs:** a new private workspace package `apps/docs` (Starlight) is the single source of the
  long-form docs. A link validator checks it on every build. It deploys to Pages from `main`.
- **Release:** one version line, `0.1.0`, for every package. A `v*` tag drives the existing binary
  release workflow, which takes its notes from `CHANGELOG.md`.

**Tech Stack:** pnpm 12 workspace, Astro + `@astrojs/starlight` + `starlight-links-validator`,
vitest (repository test in `apps/web`), `node --test` (DCO script), GitHub Actions
(`actions/deploy-pages`), `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-11-07-open-source-readiness-design.md`

## Global Constraints

- License Apache-2.0. Copyright line exactly `Copyright 2026 Sota`.
- No email address in community files, docs content or README. Contact is GitHub-only:
  - vulnerabilities: private security advisories;
  - code of conduct: `@sotarak`, through an issue titled "Code of conduct: please contact me";
  - support: Discussions and issues.
- Docs URL `https://sotarak.github.io/anchor/` (Astro `site: "https://sotarak.github.io"`,
  `base: "/anchor"`).
- Names unchanged: product Anchor, binary `anchor`, package `@anchor-secrets/cli`. All packages
  stay `"private": true`.
- English for docs, code and commits. Every commit uses `git commit -s` and ends with the
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer. Stage explicit paths.
- Never bypass pnpm `minimumReleaseAge`. Let pnpm resolve the newest versions that pass it, and
  never add excludes.
- Docs follow the code, not the pre-implementation spec. Known gaps are stated (no per-IP rate
  limit; operators add a WAF rule).
- Version `0.1.0` for every `package.json`. The release tag is `v0.1.0`, dated 2026-11-07.
- The owner authorized the release: merging to `main`, pushing, enabling Pages / private
  vulnerability reporting / Discussions, tagging and publishing (message of 2026-11-07).

## Review Focus

1. **Links under the `/anchor` base.** A root-absolute link (`/guides/deploy/`) that ignores the
   base 404s on Pages. The links validator fails the build; Task 4 Step 4 proves it catches one.
2. **Tag/version mismatch.** Pushing `v0.2.0` while the packages say `0.1.0` must fail before a
   release is created. Task 8 adds the check, plus a test of the extraction script.
3. **DCO on a fork PR.** Commits whose sign-off email differs from the author's, or lowercase
   `signed-off-by:`, must be judged as git does: the trailer is case-sensitive and must name the
   author. Task 3 tests both.
4. **Secret-looking strings in docs.** Docs examples must use placeholders. The repository test
   rejects `anc_(s|t|p)_` tokens of real length and PEM blocks in docs content (Task 2).
5. **Deploy-guide drift.** The moved deploy page must keep the "Deploy" section the scripts test
   parses. Task 4 retargets the test and runs it.

---

### Task 0: Branch and record the design

- [ ] **Step 1:** `git switch -c chore/open-source` from `feat/m5-advanced-secrets`.
- [ ] **Step 2: Commit** the spec and this plan.
  ```bash
  git add docs/superpowers/specs/2026-11-07-open-source-readiness-design.md docs/superpowers/plans/2026-11-07-open-source-readiness.md
  git commit -s -m "docs: open-source readiness design and plan"
  ```

### Task 1: License, notices and package metadata

**Files:**
- Create: `LICENSE` (the full Apache-2.0 text, appendix filled with `Copyright 2026 Sota`), `NOTICE`,
  `.claude/THIRD_PARTY_LICENSES/obra-superpowers-MIT.txt`,
  `.claude/THIRD_PARTY_LICENSES/cloudflare-skills-Apache-2.0.txt`
- Modify: every `package.json` (root, `apps/{cli,server,web}`, `packages/shared`),
  `.claude/VENDORED.md` (link the license files)
- Test: `apps/web/test/unit/deploy/repository.test.ts` (same `read()` helper as
  `deploy-scripts.test.ts`)

**Interfaces:**
- Produces: `repository.test.ts`, which later tasks extend with their own `it(...)` cases.

- [ ] **Step 1: Write the failing tests**
  - `every package.json declares Apache-2.0`: each workspace `package.json` has
    `license === "Apache-2.0"`.
  - The root and the CLI also have `repository.url === "https://github.com/sotarak/anchor.git"`,
    `homepage === "https://sotarak.github.io/anchor/"` and
    `bugs.url === "https://github.com/sotarak/anchor/issues"`.
  - `LICENSE is Apache-2.0 with the owner's copyright`: `LICENSE` contains
    `Apache License\n                           Version 2.0, January 2004` and
    `Copyright 2026 Sota`.
  - `NOTICE credits the owner and third parties`: `NOTICE` contains `Copyright 2026 Sota`,
    `obra/superpowers`, `cloudflare/skills` and `novuhq/novu`.
  - `vendored skill licenses are present`: both `.claude/THIRD_PARTY_LICENSES/*` files exist; one
    contains `MIT License` and `Jesse Vincent`, the other `Apache License`.
- [ ] **Step 2:** Run `pnpm --filter @anchor/web exec vitest run test/unit/deploy/repository.test.ts`.
  Expected: FAIL (files and fields missing).
- [ ] **Step 3: Implement.** Take the license texts verbatim:
  - Apache-2.0 from `https://www.apache.org/licenses/LICENSE-2.0.txt`.
  - The MIT text from the obra/superpowers repository at the commit in `VENDORED.md`.
- [ ] **Step 4:** Re-run. Expected: PASS.
- [ ] **Step 5: Commit** `chore: license the project under Apache-2.0`.

### Task 2: Community health files

**Files:**
- Create:
  - `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1, enforcement section per
    Global Constraints), `SECURITY.md`, `SUPPORT.md`, `CHANGELOG.md`;
  - `.github/ISSUE_TEMPLATE/{bug_report.yml, feature_request.yml, config.yml}`;
  - `.github/pull_request_template.md`, `.github/dependabot.yml` (github-actions, weekly),
    `.editorconfig`.
- Test: extend `repository.test.ts`.

What each file must cover:

- **CONTRIBUTING:**
  - Dev setup: pnpm, `.dev.vars` from the example.
  - Checks to run: `pnpm lint`, `pnpm typecheck`, `pnpm test`, the e2e commands.
  - Test layout (link to the docs page).
  - English, Biome, DCO with `git commit -s` (and what the sign-off means).
  - Security-sensitive changes need failure-case tests.
  - The optional `.claude/` skills.
  - The PR flow.
- **SECURITY:**
  - Pre-1.0 support statement.
  - Private advisory link: `https://github.com/sotarak/anchor/security/advisories/new`.
  - Scope: server, dashboard, CLI, crypto design.
  - Response targets: acknowledge within 3 days, assessment within 10 days.
  - Safe harbor.
  - No email.
- **SUPPORT:** Discussions for questions, issues for bugs.
- **CHANGELOG** (Keep a Changelog, SemVer):
  - `## [Unreleased]`, summarizing M1–M5 (core API and encryption, access and audit, CLI,
    dashboard, folders/versions/references/imports/rotation).
  - Task 8 turns it into `## [0.1.0] - 2026-11-07`.
- **Issue forms:**
  - Bug report: version, deployment (Cloudflare / local), component (server, dashboard, CLI),
    steps, expected and actual. Plus a required checkbox: "I removed secret values and tokens from
    this report".
  - `config.yml`: `blank_issues_enabled: false`, contact links to the security advisory and to
    Discussions.
- **PR template:** summary, tests run, a DCO checkbox, and a security-impact checkbox.

- [ ] **Step 1: Write the failing tests**
  - `community files exist`: each path above exists.
  - `community files and docs contain no email address`: the root `*.md` community files, `README.md`
    and every file under `apps/docs/src/content/` (when present) contain no match of
    `/[\w.+-]+@[\w-]+\.[\w.]+/`. Allow `noreply@anthropic.com` only in CONTRIBUTING, where the
    trailer convention is explained.
  - `docs content holds no secret-looking strings`: no match of `/anc_[stp]_[A-Za-z0-9_-]{40,}/`
    or `/-----BEGIN [A-Z ]*PRIVATE KEY-----/` under `apps/docs/src/content/`, nor in `README.md`.
  - `bug report requires the redaction checkbox`: `bug_report.yml` contains `required: true` under
    the checkbox whose label includes `removed secret values`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Write the files.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5: Commit** `docs: community health files`.

### Task 3: DCO check

**Files:**
- Create: `scripts/dco.mjs`, `scripts/dco.test.mjs`, `.github/workflows/dco.yml`
- Modify: root `package.json` (script `"test:scripts": "node --test scripts/"`),
  `.github/workflows/ci.yml` (`check` job runs `pnpm test:scripts`)

**Interfaces:**
- Produces:
  - `export function missingSignOffs(commits: {sha: string; authorName: string; authorEmail: string; message: string; parents: number; bot: boolean}[]): string[]`,
    which returns the shas missing a sign-off.
  - A CLI mode: `node scripts/dco.mjs <base> <head>` reads `git log --format` for `base..head`,
    prints each offending sha with a hint, and exits 1 when any are missing.

- [ ] **Step 1: Write the failing tests** (`node:test`):
  - `a commit signed off by its author passes`.
  - `missing sign-off fails`.
  - `a sign-off naming someone else fails`.
  - `lowercase "signed-off-by:" fails`.
  - `merge commits (parents > 1) and bots are skipped`.
  - `a Co-Authored-By trailer alone does not count`.
- [ ] **Step 2:** `node --test scripts/`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.** Match a line `Signed-off-by: <authorName> <authorEmail>` exactly.
  - Bots: author email ends with `[bot]@users.noreply.github.com`.
  - `dco.yml`: `on: pull_request`, checkout with `fetch-depth: 0`, then run
    `node scripts/dco.mjs ${{ github.event.pull_request.base.sha }} ${{ github.event.pull_request.head.sha }}`.
    Permissions `contents: read`.
- [ ] **Step 4:** `node --test scripts/` → PASS. Then
  `node scripts/dco.mjs feat/m5-advanced-secrets HEAD` → exit 0 (every commit on this branch is
  signed off).
- [ ] **Step 5: Commit** `ci: check DCO sign-off on pull requests`.

### Task 4: Docs site skeleton and migration of existing docs

**Files:**
- Create:
  - `apps/docs/package.json` (`@anchor/docs`, private, version `0.1.0`, Apache-2.0; scripts `dev`,
    `build`, `preview`);
  - `apps/docs/astro.config.mjs`, `apps/docs/tsconfig.json`, `apps/docs/src/content.config.ts`;
  - `apps/docs/public/favicon.svg` (a simple anchor mark);
  - `apps/docs/src/content/docs/index.mdx` (splash: pitch, feature cards, "Deploy your own" and
    "CLI" buttons).
- Move:
  - `docs/deploy.md` → `apps/docs/src/content/docs/guides/deploy.md`;
  - `docs/cli.md` → `apps/docs/src/content/docs/guides/cli.md`;
  - `docs/testing.md` → `apps/docs/src/content/docs/contributing/testing.md`.
  - Each gets `title`/`description` frontmatter, and the H1 is dropped. Content is otherwise kept
    whole: the operations split happens in Task 5.
- Create: `docs/README.md`, saying "The documentation lives at https://sotarak.github.io/anchor/
  (source: apps/docs). This folder keeps design specs and plans (superpowers/)."
- Modify:
  - `apps/web/test/unit/deploy/deploy-scripts.test.ts`: read the new deploy page.
  - The pointers in `apps/server/wrangler.jsonc`, `apps/server/.dev.vars.example`,
    `apps/server/src/admin/routes.ts` and `CLAUDE.md`: use the docs URL, or the source path for
    the testing page in CLAUDE.md.
  - `biome.json`: exclude `apps/docs/.astro` and `apps/docs/dist`.
  - `.gitignore`: add `apps/docs/.astro/`.
  - `.github/workflows/ci.yml`: the `check` job runs `pnpm --filter @anchor/docs build`.

Astro config:
- `site` and `base` as in Global Constraints.
- Starlight `title: "Anchor"`, the `social` GitHub link, an `editLink` base pointing at
  `https://github.com/sotarak/anchor/edit/main/apps/docs/`.
- The `starlightLinksValidator()` plugin.
- The sidebar groups from the spec: Start here, Guides, Operations, Security, Reference,
  Contributing, Troubleshooting. Use `autogenerate` per directory.
- Internal links are written with the base, for example `/anchor/guides/deploy/`.

- [ ] **Step 1: Retarget the scripts test** to `apps/docs/src/content/docs/guides/deploy.md`. Run
  `pnpm --filter @anchor/web exec vitest run test/unit/deploy/deploy-scripts.test.ts`.
  Expected: FAIL (file not found).
- [ ] **Step 2:** Scaffold the package, install with
  `pnpm --filter @anchor/docs add astro @astrojs/starlight starlight-links-validator sharp`, and
  move the pages.
- [ ] **Step 3:** Run `pnpm --filter @anchor/docs build` and the scripts test.
  Expected: build succeeds with no link-validator errors; test PASS.
- [ ] **Step 4: Prove the validator catches a base-less link.** Temporarily add
  `[x](/guides/deploy/)` to `index.mdx`, build, and expect FAIL naming the link. Then revert.
- [ ] **Step 5:** Run `pnpm lint && pnpm typecheck && pnpm test`. Expected: green.
- [ ] **Step 6: Commit** `docs: Starlight site with the existing guides`.

### Task 5: Docs content

**Files (all under `apps/docs/src/content/docs/`):**
- `start/introduction.md`: what Anchor is, who it is for, why Cloudflare, what it is not (no E2E
  encryption: the server holds keys).
- `start/quickstart.md`: the shortest path to a running instance, which links to the full deploy
  guide.
- `start/architecture.md`: Worker + D1 + Queues + static dashboard; request flow; the key hierarchy
  as a text diagram.
- `guides/dashboard.md`: text tour.
- `guides/ci.md`: moved out of `cli.md`'s CI section.
- `guides/references-imports.md`, `guides/versions.md`.
- `operations/`: `project-key-rotation.md`, `root-key-rotation.md`, `audit-retention.md`,
  `rate-limiting.md`, `break-glass.md`, `upgrading.md`.
  - These are split out of `guides/deploy.md`, which keeps steps 1–8 and links to them.
  - Keep the `## 5. Deploy` heading the scripts test parses.
- `security/model.md`: threat model and key hierarchy, what is encrypted, audit guarantees, known
  gaps. Link to SECURITY.md on GitHub.
- `reference/http-api.md`: route groups from `apps/server/src/app.ts`, auth schemes, error
  envelope.
- `reference/limits.md`: values read from the code, including:
  - `REFERENCE_LIMITS`;
  - `MAX_SECRET_VALUE_BYTES`;
  - the path rules in `packages/shared/src/schemas/secrets.ts`;
  - the audit metadata cap.
- `contributing/index.md`: links to CONTRIBUTING and the testing page.
- `troubleshooting.md`: `config_error`, 409 retry, CSP, the Solana `anchor` name clash (use the
  full path or an alias).

Every value stated (limits, exit codes, env vars) is read from the code, not the spec.

- [ ] **Step 1:** Write the pages.
- [ ] **Step 2:** Run `pnpm --filter @anchor/docs build`, the repository test and the scripts test.
  Expected: build succeeds with the validator clean; tests PASS (no emails, no secret-looking
  strings).
- [ ] **Step 3: Commit** `docs: guides, operations, security and reference pages`.

### Task 6: Pages deployment

**Files:** Create `.github/workflows/docs.yml`.

- Triggers:
  - `push` to `main` with paths `apps/docs/**`, `pnpm-lock.yaml` and the workflow file itself;
  - `workflow_dispatch`.
- Jobs:
  - `build`: pnpm, node 22, frozen install, `pnpm --filter @anchor/docs build`, then
    `actions/upload-pages-artifact@v3` with `path: apps/docs/dist`.
  - `deploy`: `actions/deploy-pages@v4`, environment `github-pages`.
- `permissions: { contents: read, pages: write, id-token: write }`;
  `concurrency: { group: pages, cancel-in-progress: false }`.

- [ ] **Step 1:** Write the workflow. Check that the YAML parses with
  `node -e "require('yaml')"`-style parsing (use `pnpm dlx yaml-lint` only if it passes the
  release-age policy). Otherwise review it by hand against the GitHub Pages starter workflow.
- [ ] **Step 2: Commit** `ci: deploy the docs to GitHub Pages`.

### Task 7: README

**Files:** Modify `README.md`. Test: extend `repository.test.ts`.

Sections, in order:
1. Title, a one-line pitch, badges:
   - CI: `https://github.com/sotarak/anchor/actions/workflows/ci.yml/badge.svg`;
   - license Apache-2.0;
   - docs link.
2. "Why Anchor".
3. Features (from the current README).
4. Architecture sketch.
5. Quickstart (deploy your own: 5 commands plus a link).
6. CLI taste (the existing snippet).
7. Documentation links.
8. Contributing, with a link.
9. Security, with a link.
10. License.

The development commands move to CONTRIBUTING; nothing is lost.

- [ ] **Step 1: Write the failing tests**
  - `README links resolve`: every relative markdown link target in `README.md` exists in the repo.
  - `README links the docs site`: it contains `https://sotarak.github.io/anchor/`.
- [ ] **Step 2:** Run. Expected: FAIL (the old README has no docs URL).
- [ ] **Step 3:** Rewrite. Fold the dev details into CONTRIBUTING if Task 2 has not already done so.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5: Commit** `docs: README for the public repository`.

### Task 8: Release preparation

**Files:**
- Modify:
  - all `package.json` files (`"version": "0.1.0"`; the CLI already is);
  - `CHANGELOG.md` (`## [0.1.0] - 2026-11-07`, an empty `## [Unreleased]` above it, compare and
    release links at the bottom);
  - `.github/workflows/release-cli.yml`.
- Create: `scripts/changelog.mjs`, `scripts/changelog.test.mjs`.
- Test: `repository.test.ts`.

**Interfaces:**
- Produces: `export function releaseNotes(changelog: string, version: string): string`, which
  returns the body of `## [version]` up to the next `## [`, and throws when the section is
  missing. Its CLI mode is `node scripts/changelog.mjs <version>`, which prints the notes.

Release workflow changes:
- Trigger on `v*` tags, alongside the existing `cli-v*` for compatibility.
- New first job `verify`: it fails unless the tag (without the leading `v`) equals
  `apps/cli/package.json` version, and every workspace version matches.
- The release job:
  - checks out the repo;
  - writes notes with `node scripts/changelog.mjs <version> > notes.md`;
  - creates the draft as `--title "Anchor v<version>" --notes-file notes.md`.
- Dispatch runs keep their `cli-dev-<n>` draft tag.

- [ ] **Step 1: Write the failing tests**
  - `node:test`:
    - `releaseNotes returns the 0.1.0 section only`;
    - `releaseNotes throws for a missing version`.
  - vitest: `every workspace package is version 0.1.0 and the changelog has its section`.
- [ ] **Step 2:** Run both. Expected: FAIL.
- [ ] **Step 3:** Implement and edit.
- [ ] **Step 4:** Run both. Expected: PASS. `node scripts/changelog.mjs 0.1.0` prints the section.
- [ ] **Step 5:** Run `pnpm lint && pnpm typecheck && pnpm test && pnpm test:scripts`, then build
  the docs. Expected: green.
- [ ] **Step 6: Commit** `chore: release 0.1.0`.

### Task 9: Final review

Run the whole-branch review on Opus (executing-plans Final Review), then do the fix pass.
`main..chore/open-source` also contains M5, which was already reviewed, so the review range is
`feat/m5-advanced-secrets..HEAD`.

### Task 10: Publish (outward-facing, authorized)

- [ ] **Step 1:** Fast-forward `main` to `chore/open-source` (it contains M5). Run the full suite
  on `main`, then `git push origin main`. Watch CI with `gh run watch`. Expected: CI green
  (including the wiring timeout fix).
- [ ] **Step 2: Repository settings:**
  - `gh api -X POST repos/sotarak/anchor/pages -f build_type=workflow`;
  - `gh api -X PUT repos/sotarak/anchor/private-vulnerability-reporting`;
  - `gh repo edit sotarak/anchor --enable-discussions --description "<pitch>" --homepage https://sotarak.github.io/anchor/ --add-topic secrets-management,cloudflare-workers,self-hosted,secrets,cli`.
- [ ] **Step 3:** Run the docs workflow (`gh workflow run docs.yml`) and watch it. Expected: the
  deploy succeeds; `curl -sI https://sotarak.github.io/anchor/` → 200, and
  `/anchor/guides/deploy/` → 200.
- [ ] **Step 4:** `git tag -a v0.1.0 -m "Anchor v0.1.0"` and `git push origin v0.1.0`. Watch
  `release-cli.yml`. Expected: `verify` passes, five binaries plus `SHA256SUMS` are attached to the
  draft.
- [ ] **Step 5:** Check the draft's assets and notes, then publish with
  `gh release edit v0.1.0 --draft=false --latest`. Expected: `gh release view v0.1.0` shows it
  published with six assets.
- [ ] **Step 6:** Delete `feat/m5-advanced-secrets` and `chore/open-source` locally (both are
  merged).

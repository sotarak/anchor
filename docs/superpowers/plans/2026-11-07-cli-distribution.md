# CLI Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-line installs of the `anchor` CLI through npm, Homebrew, an install script and a GitHub Action, all published automatically by a tag release.

**Architecture:** The existing esbuild bundle becomes the npm package `@anchor-secrets/cli`, which has no runtime dependencies. One POSIX install script (`apps/docs/public/install.sh`, served by GitHub Pages) downloads and verifies the release binaries; the composite Action in `setup-action/` reuses it. `release-cli.yml` publishes tag releases immediately, then publishes to npm through trusted publishing and pushes a generated Homebrew formula to `sotarak/homebrew-tap`.

**Tech Stack:** Node 22 / esbuild, pnpm 12, vitest (CLI tests), `node:test` (`scripts/*.test.mjs`), POSIX sh, GitHub Actions, Homebrew Ruby formula.

**Spec:** `docs/superpowers/specs/2026-11-07-cli-distribution-design.md`

## Global Constraints

- npm package name `@anchor-secrets/cli`; bins `anchor` and `anchor-secrets`, both → `dist/anchor.mjs`.
- `engines.node` stays `>=22.19`. The published manifest has no `dependencies` key; nothing in it contains `workspace:`.
- No `NPM_TOKEN`: npm trusted publishing (OIDC) from `.github/workflows/release-cli.yml` (keep this filename; the npm trusted publisher is bound to it).
- Release asset names are unchanged: `anchor-darwin-arm64`, `anchor-darwin-x64`, `anchor-linux-x64`, `anchor-linux-arm64`, `anchor-windows-x64.exe`, `SHA256SUMS`.
- Tap repo `sotarak/homebrew-tap`, file `Formula/anchor.rb`, secret `HOMEBREW_TAP_TOKEN`. Install command `brew install sotarak/tap/anchor`.
- Install script URL `https://sotarak.github.io/anchor/install.sh`; default download base `https://github.com/sotarak/anchor/releases`; default install dir `$HOME/.local/bin`; never calls sudo.
- Action path `setup-action/`, referenced as `sotarak/anchor/setup-action@v<version>`. Docs examples use `v0.2.0`, the first release that will contain this work.
- Every download is checked against `SHA256SUMS` and fails closed.
- No new dependencies (pnpm `minimumReleaseAge` is never bypassed). Code, comments and docs in English.
- Commits use `git commit -s` (DCO) and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **macOS without `sha256sum`** (only `shasum`): the install script verifies with `shasum -a 256`. Pinned by Task 2 "verifies with shasum when sha256sum is absent".
- **Upgrade over an existing install with a bad download**: the checksum fails, the old `anchor` still runs, and no temp file is left in the install dir. Pinned by Task 2 "fails closed on a checksum mismatch and keeps the existing binary".
- **`ANCHOR_VERSION=v0.2.0` (leading v) or `latest`**: same result as `0.2.0` / no value. Pinned by Task 2 "pins ANCHOR_VERSION with or without a leading v".
- **Install dir not on `PATH`**: the install succeeds and prints `export PATH="<dir>:$PATH"` on stderr; no hint when it is already on `PATH`. Pinned by Task 2 "hints only when the install dir is not on PATH".
- **Pre-release tag `v0.2.0-rc.1`**: npm dist-tag `next`, GitHub pre-release, Homebrew untouched. Pinned by Task 5 `releaseMeta` tests.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/cli/package.json` (modify) | Publishable manifest: bins, devDependencies only, `prepack`, `publishConfig` |
| `apps/cli/build.mjs` (modify) | Also copies root `LICENSE` and `NOTICE` into `dist/` |
| `apps/cli/README.md` (create) | npm package page |
| `apps/cli/test/integration/build.test.ts` (modify) | Adds the "npm package" suite (pack, inspect, install, run both bins) |
| `apps/docs/public/install.sh` (create) | POSIX installer for macOS/Linux (+ Git Bash for the Action) |
| `scripts/install-sh.test.mjs` (create) | Offline tests of `install.sh` with a fake `uname` and `file://` downloads |
| `scripts/homebrew-formula.mjs` (create) | `parseSums`, `homebrewFormula`, CLI that prints `anchor.rb` |
| `scripts/homebrew-formula.test.mjs` (create) | Formula generator tests |
| `setup-action/action.yml` (create) | Composite Action that runs `install.sh` and updates `PATH` |
| `.github/workflows/ci.yml` (modify) | `setup-action` job on Linux, macOS, Windows |
| `scripts/release-meta.mjs` (create) | `releaseMeta(version)` → pre-release flag and npm dist-tag |
| `scripts/release-meta.test.mjs` (create) | Its tests |
| `.github/workflows/release-cli.yml` (modify) | Non-draft tag releases, `npm` job, `homebrew` job |
| `apps/docs/src/content/docs/guides/{cli,ci}.md`, `start/quickstart.md`, `troubleshooting.md`, `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md` (modify) | Docs |

---

### Task 1: Publishable npm package

**Files:**
- Modify: `apps/cli/package.json`
- Modify: `apps/cli/build.mjs`
- Create: `apps/cli/README.md`
- Test: `apps/cli/test/integration/build.test.ts`

**Interfaces:**
- Produces: `pnpm --filter ./apps/cli pack --pack-destination <dir>` writes `anchor-secrets-cli-<version>.tgz` (Task 5 publishes this tarball).

- [ ] **Step 1: Write the failing tests**

Add a second `describe("npm package")` in `build.test.ts`. Keep it in this file, after the existing suite: vitest runs files in parallel, and only this file may write `dist/`. In `beforeAll` (timeout 120 s), make a temp dir with `mkdtemp`, run `pnpm pack --pack-destination <tmp>` with `cwd` = `apps/cli` (this runs `prepack`), and extract the single `.tgz` with `tar -xzf <tgz> -C <tmp>`. Tests:

```ts
it("ships only the bundle, license files, README and manifest", async () => {
  expect((await listFiles(join(tmp, "package"))).sort()).toEqual(
    ["README.md", "dist/LICENSE", "dist/NOTICE", "dist/anchor.mjs", "package.json"],
  );
});

it("has a publishable manifest with no runtime dependencies", async () => {
  const m = JSON.parse(await readFile(join(tmp, "package/package.json"), "utf8"));
  expect(m.name).toBe("@anchor-secrets/cli");
  expect(m.private).toBeUndefined();
  expect(m.dependencies).toBeUndefined();
  expect(m.bin).toEqual({ anchor: "dist/anchor.mjs", "anchor-secrets": "dist/anchor.mjs" });
  expect(m.publishConfig).toEqual({ access: "public" });
  expect(JSON.stringify(m)).not.toContain("workspace:");
});

it.skipIf(process.platform === "win32")("installs globally and runs as both commands", async () => {
  // npm install -g --prefix <tmp>/prefix <tgz> --offline --no-audit --no-fund
  for (const bin of ["anchor", "anchor-secrets"]) {
    const { stdout } = await run(join(prefix, "bin", bin), ["--version"]);
    expect(stdout).toBe(`${pkg.version}\n`);
  }
});
```

`listFiles` is a small recursive `readdir` helper local to the test file that returns relative POSIX paths.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter ./apps/cli exec vitest run test/integration/build.test.ts`
Expected: FAIL. The packed `package.json` has `private`, `dependencies` and a single bin; there are no `dist/LICENSE`, `dist/NOTICE` or `README.md`.

- [ ] **Step 3: Make the package publishable**

`apps/cli/package.json`:
- Remove `"private": true`.
- Add `"description": "CLI for Anchor, a self-hosted secrets manager on Cloudflare Workers"` and `"keywords": ["secrets", "env", "cloudflare", "cli", "dotenv"]`.
- Set the bins to `{ "anchor": "dist/anchor.mjs", "anchor-secrets": "dist/anchor.mjs" }`.
- Add `"publishConfig": { "access": "public" }` and `"prepack": "node build.mjs"`.
- Move every entry of `dependencies` into `devDependencies`, keep the versions, and delete the `dependencies` key. esbuild bundles all of them, `@anchor/shared` included.
- Keep `repository`, `homepage` and `bugs` as they are; provenance checks `repository.url` against `sotarak/anchor`.

`build.mjs`: after the bundle, `copyFile` the repo root `LICENSE` and `NOTICE` (`new URL("../../LICENSE", import.meta.url)`) to `dist/LICENSE` and `dist/NOTICE`.

`README.md` (npm page, about 40 lines):
- One-paragraph description.
- Install: `npm install -g @anchor-secrets/cli`, or `npx @anchor-secrets/cli <command>`, Node 22.19+. Mention both command names and why `anchor-secrets` exists.
- The four-line getting-started block from `guides/cli.md`.
- Links to the CLI guide, the CI guide and the docs home.
- The line "Secret values are never accepted as arguments".

Run `pnpm install` afterwards so the lockfile reflects the moved dependencies (versions unchanged).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter ./apps/cli exec vitest run test/integration/build.test.ts && pnpm --filter ./apps/cli test && pnpm typecheck && pnpm lint`
Expected: all PASS. The help snapshot is unchanged: the program name stays `anchor`.

- [ ] **Step 5: Commit**

```bash
git add apps/cli/package.json apps/cli/build.mjs apps/cli/README.md apps/cli/test/integration/build.test.ts pnpm-lock.yaml
git commit -s -m "feat(cli): make @anchor-secrets/cli publishable to npm"
```

---

### Task 2: Install script

**Files:**
- Create: `apps/docs/public/install.sh`
- Test: `scripts/install-sh.test.mjs` (picked up by `pnpm test:scripts`)

**Interfaces:**
- Produces (used by Task 4): `sh install.sh` honoring these environment variables:
  - `ANCHOR_VERSION`: empty or `latest` means latest; otherwise `X.Y.Z[-pre]`, with or without a leading `v`.
  - `ANCHOR_INSTALL_DIR`: default `$HOME/.local/bin`.
  - `ANCHOR_DOWNLOAD_BASE`: default `https://github.com/sotarak/anchor/releases`.
  - It installs `<dir>/anchor` plus a symlink `<dir>/anchor-secrets`, or only `<dir>/anchor.exe` on MINGW/MSYS/CYGWIN.
  - It exits 0 on success and 1 on any error. Messages go to stderr.

- [ ] **Step 1: Write the failing tests**

Test harness in `scripts/install-sh.test.mjs`. A `fixture({ os = "Linux", arch = "x86_64" })` helper creates a temp dir with:
- `releases/latest/download/` holding every asset as a fake binary (`#!/bin/sh\necho 9.9.9`) plus a matching `SHA256SUMS`, computed with `node:crypto` in `sha256sum` format (`<hex>  <name>`).
- `releases/download/v0.2.0/`, the same layout with binaries that print `0.2.0`.
- `shim/uname`, which prints `os` for `-s` and `arch` for `-m`.

A `runInstall(fx, env)` helper runs `sh apps/docs/public/install.sh` with `PATH=<shim>:<process PATH>`, `HOME=<tmp>`, `ANCHOR_DOWNLOAD_BASE=file://<tmp>/releases`, `ANCHOR_INSTALL_DIR=<tmp>/bin`, plus `env`. It returns `{ code, stderr }`. Tests:

| Test name | Setup | Assertions |
|---|---|---|
| installs the latest linux-x64 binary as anchor and anchor-secrets | defaults | code 0; `bin/anchor --version` → `9.9.9`; `bin/anchor-secrets --version` → `9.9.9`; `bin/anchor` mode has `0o111` |
| maps aarch64 to the arm64 asset | `arch: "aarch64"`, `anchor-linux-arm64` prints `arm` | `bin/anchor` prints `arm` |
| pins ANCHOR_VERSION with or without a leading v | run with `0.2.0`, then `v0.2.0`, then `latest` | prints `0.2.0`, `0.2.0`, `9.9.9` |
| fails closed on a checksum mismatch and keeps the existing binary | pre-create `bin/anchor` printing `old`; corrupt the linux-x64 line in `SHA256SUMS` | code 1; stderr matches `/checksum/i`; `bin/anchor` prints `old`; `bin/` holds only `anchor` |
| fails when the asset is missing from SHA256SUMS | drop the linux-x64 line | code 1; `bin/anchor` does not exist |
| rejects an unsupported OS and points to npm | `os: "FreeBSD"` | code 1; stderr contains `npm install -g @anchor-secrets/cli` |
| verifies with shasum when sha256sum is absent | PATH = a dir of symlinks to every tool the script uses (resolved with `command -v`) **except** `sha256sum`, plus a `shasum` shim that touches `<tmp>/shasum-called` and runs the real `sha256sum` on its last argument | code 0; `<tmp>/shasum-called` exists |
| hints only when the install dir is not on PATH | run once as is, once with `<tmp>/bin` prepended to `PATH` | first stderr contains `export PATH="<tmp>/bin:$PATH"`; second does not |
| installs anchor.exe without an alias on Windows shells | `os: "MINGW64_NT-10.0-20348"` | `bin/anchor.exe` exists; `bin/anchor-secrets` and `bin/anchor` do not |

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/install-sh.test.mjs`
Expected: FAIL (`install.sh` does not exist).

- [ ] **Step 3: Write `apps/docs/public/install.sh`**

Start with `#!/bin/sh` and `set -eu`, followed by a header comment: what it does, the three variables, and "review before piping to sh". Behavior, in order:
1. Platform. `uname -s`: `Darwin`→`darwin`, `Linux`→`linux`, `MINGW*|MSYS*|CYGWIN*`→`windows`. Anything else exits with `Unsupported OS: <name>. Install with npm: npm install -g @anchor-secrets/cli`. `uname -m`: `x86_64|amd64`→`x64`, `arm64|aarch64`→`arm64`, else error. `windows`+`arm64` is an error. Asset = `anchor-<os>-<arch>`, plus `.exe` on windows.
2. Version. Empty or `latest` → `$BASE/latest/download/`. Otherwise strip one leading `v`, check against `^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$` (error otherwise), and use `$BASE/download/v<ver>/`.
3. Require `curl` (error naming it). Download the asset and `SHA256SUMS` into a `mktemp -d` dir, removed by `trap ... EXIT`, with `curl -fsSL -o`.
4. The expected hash is the first field of the `SHA256SUMS` line whose second field (with a leading `*` stripped) equals the asset; error if there is none. Compute the actual hash with `sha256sum`, else `shasum -a 256`, else error. A mismatch exits 1 with `checksum mismatch for <asset>` before touching the install dir.
5. `mkdir -p` the dir. Copy to `<dir>/.anchor.tmp.$$`, `chmod 755`, then `mv -f` to `anchor` (or `anchor.exe`). This is atomic on the same filesystem, so an existing binary is never half-written. If anything fails between copy and move, remove the temp file. On non-windows, `ln -sf anchor <dir>/anchor-secrets`.
6. Print `Installed anchor <`--version` output> to <dir>`. If `case ":$PATH:"` does not contain `:<dir>:`, print `Add it to your PATH: export PATH="<dir>:$PATH"` (literal `$PATH` in the message).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/install-sh.test.mjs && pnpm test:scripts && pnpm lint`
Expected: PASS. If `shellcheck` is available, `shellcheck -s sh apps/docs/public/install.sh` reports nothing.

- [ ] **Step 5: Commit**

```bash
git add apps/docs/public/install.sh scripts/install-sh.test.mjs
git commit -s -m "feat(cli): add a verified install script served from the docs site"
```

---

### Task 3: Homebrew formula generator

**Files:**
- Create: `scripts/homebrew-formula.mjs`
- Test: `scripts/homebrew-formula.test.mjs`

**Interfaces:**
- Produces:
  - `parseSums(text: string): Record<string, string>` (asset → hex; tolerates the `*` binary marker and blank lines).
  - `homebrewFormula({ version, sums }: { version: string; sums: Record<string, string> }): string`.
  - CLI `node scripts/homebrew-formula.mjs <version> <path to SHA256SUMS>` prints the formula to stdout and exits 1 with a message on error (used by Task 5).

- [ ] **Step 1: Write the failing tests** (`node:test`, style of `scripts/changelog.test.mjs`)

- `parseSums reads sha256sum output`: `"<a>  anchor-linux-x64\n<b> *anchor-darwin-arm64\n\n"` → `{ "anchor-linux-x64": a, "anchor-darwin-arm64": b }`.
- `homebrewFormula pins every macOS and Linux asset to its checksum`: with 4 distinct 64-hex sums plus a windows entry, for each of the 4 assets the output contains `url "https://github.com/sotarak/anchor/releases/download/v0.2.0/<asset>"` immediately followed by the line `sha256 "<its sum>"`; the output contains `version "0.2.0"` and does not contain `windows`.
- `homebrewFormula installs both command names`: output contains `=> "anchor"` and `bin.install_symlink "anchor" => "anchor-secrets"`.
- `homebrewFormula throws for a missing asset`: without `anchor-linux-arm64` it throws `/anchor-linux-arm64/`.
- `homebrewFormula rejects a malformed checksum`: `"abc"` throws `/sha256/i`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/homebrew-formula.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `scripts/homebrew-formula.mjs`**

The output template is fixed copy:

```ruby
class Anchor < Formula
  desc "CLI for Anchor, a self-hosted secrets manager on Cloudflare"
  homepage "https://sotarak.github.io/anchor/"
  version "<version>"
  license "Apache-2.0"

  on_macos do
    on_arm do
      url "<base>/anchor-darwin-arm64"
      sha256 "<sum>"
    end
    on_intel do
      url "<base>/anchor-darwin-x64"
      sha256 "<sum>"
    end
  end

  on_linux do
    on_arm do
      url "<base>/anchor-linux-arm64"
      sha256 "<sum>"
    end
    on_intel do
      url "<base>/anchor-linux-x64"
      sha256 "<sum>"
    end
  end

  def install
    bin.install Dir["anchor-*"].first => "anchor"
    bin.install_symlink "anchor" => "anchor-secrets"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/anchor --version").strip
  end
end
```

`<base>` = `https://github.com/sotarak/anchor/releases/download/v<version>`. Guard the CLI entry with `import.meta.url === pathToFileURL(process.argv[1]).href`, as `changelog.mjs` does.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test scripts/homebrew-formula.test.mjs && d=$(mktemp -d) && node scripts/homebrew-formula.mjs 0.2.0 "$d/SHA256SUMS" > "$d/anchor.rb" && ruby -c "$d/anchor.rb" && pnpm lint`
Expected: PASS and `Syntax OK`. (Write a fixture `SHA256SUMS` with the 5 asset names into `$d` first; never into the repo.)

- [ ] **Step 5: Commit**

```bash
git add scripts/homebrew-formula.mjs scripts/homebrew-formula.test.mjs
git commit -s -m "feat(release): generate the Homebrew formula from SHA256SUMS"
```

---

### Task 4: `setup-action` for CI

**Files:**
- Create: `setup-action/action.yml`
- Modify: `.github/workflows/ci.yml` (new job `setup-action`)

**Interfaces:**
- Consumes: `install.sh` (Task 2) at `$GITHUB_ACTION_PATH/../apps/docs/public/install.sh`. A `uses: owner/repo/path@ref` reference downloads the whole repository at `ref`, so the path exists.
- Produces: input `version` (default `latest`), output `version`.

- [ ] **Step 1: Write the failing CI job**

In `ci.yml`, add this job (no `needs`, so it runs in parallel):

```yaml
  setup-action:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - id: anchor
        uses: ./setup-action
        with:
          version: 0.1.0
      - shell: bash
        run: |
          test "$(anchor --version)" = 0.1.0
          test "${{ steps.anchor.outputs.version }}" = 0.1.0
      - if: runner.os != 'Windows'
        run: test "$(anchor-secrets --version)" = 0.1.0
```

- [ ] **Step 2: Verify it fails**

Run: `actionlint .github/workflows/ci.yml` (install with `brew install actionlint` if missing).
Expected: an error that `./setup-action` has no `action.yml`.

- [ ] **Step 3: Write `setup-action/action.yml`**

- `name: Setup Anchor CLI`, a one-line description, `branding` (icon `anchor`, color `red`).
- `inputs.version`: description `Version to install (e.g. 0.2.0), or latest`, default `latest`.
- `outputs.version`: value `${{ steps.install.outputs.version }}`.
- `runs.using: composite`. One step `id: install`, `shell: bash`, env `ANCHOR_VERSION: ${{ inputs.version }}` and `ANCHOR_INSTALL_DIR: ${{ runner.temp }}/anchor-bin`. It runs `sh "$GITHUB_ACTION_PATH/../apps/docs/public/install.sh"`, appends `$ANCHOR_INSTALL_DIR` to `$GITHUB_PATH`, and writes `version=$("$ANCHOR_INSTALL_DIR/anchor" --version)` to `$GITHUB_OUTPUT`.

- [ ] **Step 4: Verify it passes**

Run: `actionlint .github/workflows/ci.yml`, then push the branch.
Expected: actionlint clean; the `setup-action` job is green on all three OSes. (If the Windows leg fails on a backslash `runner.temp`, convert it with `cygpath -u` for the script and keep the Windows form for `$GITHUB_PATH`.)

- [ ] **Step 5: Commit**

```bash
git add setup-action/action.yml .github/workflows/ci.yml
git commit -s -m "feat(ci): add the setup-action composite action"
```

---

### Task 5: Release workflow publishes everywhere

**Files:**
- Create: `scripts/release-meta.mjs`, `scripts/release-meta.test.mjs`
- Modify: `.github/workflows/release-cli.yml`

**Interfaces:**
- Consumes: the Task 1 tarball (`pnpm --filter ./apps/cli pack`) and the Task 3 CLI `node scripts/homebrew-formula.mjs <version> <SHA256SUMS>`.
- Produces: `releaseMeta(version: string): { prerelease: boolean; npmTag: "latest" | "next" }`. The CLI `node scripts/release-meta.mjs <version>` prints `prerelease=<true|false>` and `npm_tag=<tag>`, one per line, for `$GITHUB_OUTPUT`.

- [ ] **Step 1: Write the failing tests**

```js
test("a plain version is a stable release on latest", () => {
  assert.deepEqual(releaseMeta("0.2.0"), { prerelease: false, npmTag: "latest" });
});
test("a pre-release suffix goes to next", () => {
  assert.deepEqual(releaseMeta("0.2.0-rc.1"), { prerelease: true, npmTag: "next" });
});
test("releaseMeta rejects a non-semver version", () => {
  assert.throws(() => releaseMeta("v0.2"), /v0\.2/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test scripts/release-meta.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `releaseMeta` and change the workflow**

`releaseMeta`: validate with the semver pattern from Task 2, step 3; `prerelease` = contains `-`.

`release-cli.yml`:
- Rewrite the header comment. A tag publishes the GitHub Release, npm and Homebrew; manual runs make a `cli-dev-<n>` draft only.
- `verify` job: after the existing checks, run `node scripts/release-meta.mjs "$version" >> "$GITHUB_OUTPUT"` and expose outputs `prerelease` and `npm_tag`.
- `release` job: tags run `gh release create` **without** `--draft`, adding `--prerelease` when `needs.verify.outputs.prerelease == 'true'`. Manual runs keep `--draft`.
- New job `npm`, gated on `github.ref_type == 'tag'`, `needs: [verify, release]`, ubuntu, `permissions: { contents: read, id-token: write }`:
  1. Checkout, `pnpm/action-setup@v6`, `actions/setup-node@v7` with `node-version: 24` and `registry-url: https://registry.npmjs.org`, then `pnpm install --frozen-lockfile`.
  2. Guard: fail unless `npm --version` is ≥ 11.5.1 (trusted publishing needs it).
  3. Step `id: published`: if `npm view "@anchor-secrets/cli@$VERSION" version` succeeds, emit `::notice::@anchor-secrets/cli@$VERSION is already on npm` and set `skip=true`. Later steps run only if `steps.published.outputs.skip != 'true'`.
  4. `pnpm --filter ./apps/cli pack --pack-destination "$RUNNER_TEMP/pkg"`. Smoke test: `npm install -g --prefix "$RUNNER_TEMP/prefix" "$RUNNER_TEMP"/pkg/*.tgz`, then check that both `bin/anchor --version` and `bin/anchor-secrets --version` equal `$VERSION`.
  5. `npm publish "$RUNNER_TEMP"/pkg/*.tgz --access public --tag "$NPM_TAG"`.
- New job `homebrew`, gated on `github.ref_type == 'tag' && needs.verify.outputs.prerelease == 'false'`, `needs: [verify, release]`, ubuntu, `permissions: contents: read`:
  1. Step `id: token`, with env `TAP_TOKEN: ${{ secrets.HOMEBREW_TAP_TOKEN }}`: if it is empty, emit `::warning::HOMEBREW_TAP_TOKEN is not set; skipping the Homebrew update` and set `skip=true`. Later steps run only if not skipped.
  2. Checkout. `gh release download "$TAG" -p SHA256SUMS -D dist` with `GH_TOKEN: ${{ github.token }}`. Then `node scripts/homebrew-formula.mjs "$VERSION" dist/SHA256SUMS > anchor.rb` and `ruby -c anchor.rb`.
  3. `actions/checkout@v4` with `repository: sotarak/homebrew-tap`, `token: ${{ secrets.HOMEBREW_TAP_TOKEN }}`, `path: tap`.
  4. Copy to `tap/Formula/anchor.rb` (creating `Formula/`). If `git -C tap status --porcelain` is empty, stop; otherwise commit as `github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>` with message `anchor <version>` and push.

- [ ] **Step 4: Verify**

Run: `node --test scripts/release-meta.test.mjs && pnpm test:scripts && actionlint .github/workflows/release-cli.yml && pnpm lint`
Expected: PASS, actionlint clean. After pushing, run the workflow once with `workflow_dispatch`. Expected: a `cli-dev-<n>` draft, with `npm` and `homebrew` skipped.

- [ ] **Step 5: Commit**

```bash
git add scripts/release-meta.mjs scripts/release-meta.test.mjs .github/workflows/release-cli.yml
git commit -s -m "feat(release): publish tag releases to npm and Homebrew"
```

---

### Task 6: Documentation

**Files:**
- Modify: `apps/docs/src/content/docs/guides/cli.md`, `guides/ci.md`, `start/quickstart.md`, `troubleshooting.md`, `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`

- [ ] **Step 1: Update the docs**

- `guides/cli.md` "Install", in this order:
  1. npm (`npm install -g @anchor-secrets/cli`, `npx @anchor-secrets/cli <command>`, Node 22.19+).
  2. Homebrew (`brew install sotarak/tap/anchor`).
  3. Install script (`curl -fsSL https://sotarak.github.io/anchor/install.sh | sh`, the three variables, "read it first").
  4. Release binaries (Windows `.exe`, `SHA256SUMS`).
  5. From the workspace.

  Every method installs `anchor` and `anchor-secrets`; the Windows binary is only `anchor.exe`. Delete the "placeholder" sentence.
- `start/quickstart.md` step 3 and README "The CLI": show `npm install -g @anchor-secrets/cli` and the brew line, and link to the CLI guide for the others.
- `guides/ci.md` step 2: replace the curl step with `- uses: sotarak/anchor/setup-action@v0.2.0` and `with: { version: 0.2.0 }`. Mention `npx -y @anchor-secrets/cli@0.2.0 run ...` as the alternative when Node is already on the runner.
- `troubleshooting.md` "`anchor` runs a different program": lead with "use the `anchor-secrets` command, installed by npm, Homebrew and the install script". Keep the manual rename for raw binaries.
- `CONTRIBUTING.md`: new "Releasing" section.
  - Steps: bump every `package.json` version, add the CHANGELOG section, and push tag `v<version>`. A tag publishes immediately: GitHub Release, npm, Homebrew. A pre-release suffix goes to npm `next` and skips Homebrew.
  - One-time setup:
    - Create the npm org `anchor-secrets`.
    - Publish the first version by hand if npm requires the package to exist before you can add a trusted publisher (`pnpm --filter ./apps/cli pack`, then `npm publish <tgz> --access public`).
    - Add the trusted publisher: repository `sotarak/anchor`, workflow `release-cli.yml`.
    - Create the repo `sotarak/homebrew-tap`.
    - Add a fine-grained token with contents read/write on that repo only, saved as the Actions secret `HOMEBREW_TAP_TOKEN`.
- `CHANGELOG.md` `[Unreleased]`:
  - Added: npm package, Homebrew tap, install script, `setup-action`, the `anchor-secrets` command.
  - Changed: tag releases are published immediately instead of as drafts.

- [ ] **Step 2: Verify**

Run: `pnpm --filter @anchor/docs build && pnpm lint && grep -rn "placeholder" apps/docs/src/content/docs/guides/cli.md`
Expected: the docs build passes the link validator; grep prints nothing.

- [ ] **Step 3: Commit**

```bash
git add apps/docs README.md CONTRIBUTING.md CHANGELOG.md
git commit -s -m "docs: document npm, Homebrew, install script and setup-action installs"
```

---

## Owner actions outside the repository (before the first tag)

These are listed in CONTRIBUTING (Task 6) and cannot be done by an implementer:
1. Create the npm org `anchor-secrets`, then configure the trusted publisher (with a first manual publish if npm requires it).
2. Create the public repo `sotarak/homebrew-tap` and the `HOMEBREW_TAP_TOKEN` secret.
3. Bump the version to `0.2.0` and tag `v0.2.0`.

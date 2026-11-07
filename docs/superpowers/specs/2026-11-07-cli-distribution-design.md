# CLI distribution — design

Date: 2026-11-07. Status: approved by the owner (decisions below).

## Intent

Installing the `anchor` CLI today means picking the right release asset by hand, checking it
against `SHA256SUMS`, `chmod +x`, and moving it onto `PATH`. CI jobs repeat that with `curl`. The
docs still call the npm name a placeholder. This design gives developers and CI one-line installs
and makes a tag release publish everywhere without manual steps.

This supersedes one non-goal of `2026-11-07-open-source-readiness-design.md`: the CLI package
is now published to npm. Every other package stays `"private": true`.

Out of scope: deploying the server (a separate design), code signing and notarization, Scoop or
winget, an update notifier, a PowerShell install script.

## Decisions (owner)

1. **npm package `@anchor-secrets/cli`**, the existing esbuild bundle (`dist/anchor.mjs`), Node
   22.19 or later. All runtime code is bundled, so the published manifest has **no
   `dependencies`**.
2. **Two command names** wherever Anchor installs the CLI (npm, Homebrew, install script):
   `anchor` and `anchor-secrets`. The second avoids the clash with Solana's `anchor`. The Windows
   path of the install script installs `anchor.exe` only.
3. **npm trusted publishing (OIDC)** from `.github/workflows/release-cli.yml`. No `NPM_TOKEN`.
   Provenance comes with it.
4. **Tag releases are no longer drafts.** A `v<version>` tag builds the binaries, publishes the
   GitHub Release, publishes to npm and updates Homebrew. Manual workflow runs still make a
   `cli-dev-<n>` draft and publish nothing else.
   - A version with a pre-release suffix (`0.2.0-rc.1`) is a GitHub pre-release, uses the npm
     dist-tag `next`, and does not update Homebrew.
   - Re-running the workflow for a version already on npm skips the npm publish instead of failing.
5. **Homebrew tap `sotarak/homebrew-tap`**, formula `Formula/anchor.rb`, installing the release
   binaries for macOS and Linux (arm64, x64). The release workflow generates the formula and pushes
   it with a fine-grained token stored as `HOMEBREW_TAP_TOKEN` (contents: write on the tap repo
   only). Without the secret the job warns and skips. Install: `brew install sotarak/tap/anchor`.
6. **Install script** at `https://sotarak.github.io/anchor/install.sh` (served from
   `apps/docs/public/`), POSIX `sh`, advertised for macOS and Linux.
   - It picks the asset from `uname`, downloads the asset and `SHA256SUMS`, and verifies before
     installing (`sha256sum`, else `shasum -a 256`). It fails closed and leaves an existing install
     untouched.
   - It installs to `$HOME/.local/bin` by default, without sudo, and prints a `PATH` hint when
     needed.
   - `ANCHOR_VERSION` (`latest` by default, accepts `0.2.0` or `v0.2.0`), `ANCHOR_INSTALL_DIR`,
     `ANCHOR_DOWNLOAD_BASE` (mirrors and tests).
   - It also recognizes Git Bash/MSYS (`windows-x64` asset) so the GitHub Action can reuse it; that
     path is not advertised as a Windows install method.
7. **GitHub Action in `setup-action/`** of this repository:
   `uses: sotarak/anchor/setup-action@v<version>`, input `version` (default `latest`), output
   `version`. It runs the install script and adds the directory to `PATH`. It works on Linux,
   macOS and Windows runners.
8. **Windows** installs through npm or the `.exe` release asset, as today.

## Docs

The CLI guide's install section lists npm, Homebrew, the install script, release binaries and
building from source, in that order. The quickstart, README, CI guide (uses the Action) and
troubleshooting (the `anchor-secrets` name) follow. CONTRIBUTING gains a "Releasing" section with the
one-time setup: the npm org, the trusted publisher, the tap repo and its token.

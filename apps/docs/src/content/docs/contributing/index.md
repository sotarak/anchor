---
title: Contributing
description: How to set up a development environment, run the checks and send a pull request.
sidebar:
  order: 1
---

Anchor welcomes contributions. The full guide is
[CONTRIBUTING.md](https://github.com/sotarak/anchor/blob/main/CONTRIBUTING.md) in the repository;
this page is the short version.

- **Set up:** Node.js 22+, pnpm (`corepack enable`), `openssl`. `pnpm install`, then follow the
  development setup in CONTRIBUTING.md to run the Worker and the dashboard locally.
- **Check:** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:scripts` and
  `pnpm --filter @anchor/docs build` must pass. CI runs the end-to-end suites too.
- **Test first.** Bug fixes start with a failing test. Security-sensitive changes (crypto,
  authorization, tokens, audit) need tests for the failure cases. See the
  [test layout](/anchor/contributing/testing/).
- **Sign off** every commit (`git commit -s`): Anchor uses the
  [Developer Certificate of Origin](https://developercertificate.org/), checked in CI.
- **Security issues** go through
  [private vulnerability reporting](https://github.com/sotarak/anchor/security/advisories/new),
  never a public issue.
- Questions and ideas: [GitHub Discussions](https://github.com/sotarak/anchor/discussions).

This site lives in `apps/docs` (Starlight). Run it with `pnpm --filter @anchor/docs dev` and open
`http://localhost:4321/anchor/`; every page has an **Edit page** link.

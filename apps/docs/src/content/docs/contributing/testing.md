---
title: Test layout
description: Where tests live, which layer a test belongs to, and the rules that keep the suites fast.
sidebar:
  order: 2
---

Tests live in a `test/` tree beside `src/`, never inside `src/`. Inside `test/`, the first level is
the **layer** (what a test needs to run). Below that, paths **mirror `src/`**, so the tests for
`src/secrets/service.ts` are at `test/<layer>/secrets/service.test.ts`. One source module can have
tests in several layers.

```
<package>/
  src/secrets/service.ts
  test/
    support/                      shared test infrastructure, never contains tests
    unit/<mirror of src>/         *.test.ts
    integration/<mirror of src>/  *.test.ts
    api/<mirror of src>/          *.test.ts      (server only)
```

## Rules

1. **Pick the lowest layer that can prove the behavior.** A function with no I/O is a unit test, even
   if it lives in a feature folder.
2. **Mirror the source path.** Name the file after the module it tests: `src/crypto/keyring.ts` →
   `test/unit/crypto/keyring.test.ts`. A test that spans a whole feature is named after the feature
   (`test/api/secrets/secrets.test.ts`). App-wide behaviors (error contract, leak canaries, health)
   sit at the top of their layer (`test/api/no-leak.test.ts`).
3. **Shared helpers go in `test/support/`, split by concern**, never in one growing file. Import them
   through the support entry point (`#test/support` on the server). A new domain adds
   `support/factories/<domain>.ts` and re-exports it from `support/index.ts`.
4. **Import source through `#src/...`** on the server (Node subpath imports in
   `apps/server/package.json`), not through `../../../src`. Moving a test file never breaks its
   imports.
5. **Every layer has its own script**: `pnpm test` runs all layers; `test:<layer>` runs one.
6. **One test file per migration**: `migrations/0002_access.sql` →
   `test/integration/db/migration-0002.test.ts`.
7. **A new table needs a `resetDb` entry.** `test/support/db.ts` lists every table child-first;
   `test/integration/db/reset.test.ts` fails when a migration adds a table that is not listed.

## Layers per package

| Package | Layer | Contains | Runs in |
|---------|-------|----------|---------|
| `apps/server` | `unit/` | pure logic: crypto, encoding, lockout, policy, log redaction | workerd |
| | `integration/` | services and repos against a real local D1; schema and migrations | workerd + D1 |
| | `api/` | HTTP through the Worker's fetch handler: status codes, auth, CSRF, error bodies | workerd + D1 |
| `packages/shared` | `unit/` is implicit: tests sit directly under `test/<mirror>` | schemas, pure helpers | Node |
| `apps/cli` | `unit/` | output formatting, config parsing, env-file rendering | Node |
| | `integration/` | commands run through `runCli` with fake API, prompts, spawner, temp dirs | Node |
| | `e2e/` | the built CLI against a real local server (`vitest.e2e.config.ts`) | Node + workerd |
| `apps/web` | `unit/` | `src/lib` helpers, query keys, formatting | jsdom |
| | `components/` | `src/components` rendered with Testing Library | jsdom |
| | `routes/` | `src/routes` screens with MSW handlers | jsdom + MSW |
| | `features/` | `src/features/<feature>` modules (screens, hooks) with MSW handlers | jsdom + MSW |
| | `e2e/` | Playwright smoke against `wrangler dev` (`*.spec.ts`) | browser |

`packages/shared` is small and has no I/O, so it skips the layer level: `src/schemas/secrets.ts` →
`test/schemas/secrets.test.ts`. Add a layer level if it ever gains a test that needs more than Node.

## Source layout that keeps this scalable

- **Server:** one folder per feature under `src/` (`auth/`, `projects/`, `secrets/`, later
  `members/`, `audit/`, ...), each with `routes.ts`, `service.ts` and `repo.ts` as needed. Shared
  infrastructure stays in `src/lib/` and `src/crypto/`.
- **Shared:** schemas are split by domain under `src/schemas/<domain>.ts` and re-exported from
  `src/schemas/index.ts`. A new domain adds a file; it does not grow an existing one.

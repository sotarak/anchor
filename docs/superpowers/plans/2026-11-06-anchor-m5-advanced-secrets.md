# Anchor M5 — Advanced Secrets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit folders, version history with rollback, secret references, folder imports, and KEK and root-key rotation, across the API, the CLI and the dashboard.

**Architecture:** Server features stay grouped by folder in `apps/server/src`:
- **Folders and imports** are new tables (`0003_folders_imports.sql`).
- **References:**
  - A pure tokenizer in `@anchor/shared`, so the server and the web can share it.
  - A server-side resolver that takes injected `load` and `authorize` callbacks and enforces depth, cycle and size limits.
- **KEK rotation:**
  - The `POST` handler creates the new KEK version and a `key_rotations` row.
  - Messages on the Queue `anchor-reencrypt`, consumed by the same Worker, re-encrypt up to 100 versions each. Every update is conditional, so the work is idempotent.
- **Root-key rotation:** the server holds a keyring with a current and an optional previous root key. An owner-only endpoint re-wraps the KEK rows.
- **CLI and dashboard:** thin clients over the new endpoints.

**Tech Stack:** As in M1–M4, plus Cloudflare Queues (producer and consumer bindings in `apps/server/wrangler.jsonc`) and the M2 Cron Trigger.

**Spec:** `docs/superpowers/specs/2026-11-06-anchor-design.md`. Read §6.2, §9 and §13 (13.3–13.6, M5 rows). The M1 plan `docs/superpowers/plans/2026-11-06-anchor-m1-core-api.md` defines the names this plan consumes. The M2–M4 plans define the rest; Task 0 checks all of them against the merged code.

## Global Constraints

- Every M1 Global Constraint still applies: English in code, comments, commits and docs; no secret values in logs; only `crypto.getRandomValues`; timestamps are ms epoch; every error body is `{ error: { code, message } }`; every `/api` response sends `Cache-Control: no-store`.
- AAD formats stay unchanged: `anchor/kek/v1|<projectId>|<kekVersion>` and `anchor/secret/v1|<projectId>|<environmentId>|<secretId>|<version>`. Re-encryption and rollback compute AAD for the row they write.
- Reference grammar is exactly `${KEY}` or `${<envSlug>:<path>/<KEY>}`, where `<path>` is `/` or `/seg(/seg)*`. Examples: `${prod:/DB_URL}` means path `/` and key `DB_URL`; `${prod:/db/PASSWORD}` means path `/db` and key `PASSWORD`.
- **Escape rule:** `$${` yields a literal `${` and is never expanded. Any other `$` is literal. Text that starts with `${` but does not match the grammar (e.g. `${VAR:-x}` or `${a b}`) is literal.
- **A grammar-valid reference whose target does not exist is an error** (400). Expansion fails closed and never substitutes an empty string.
- Reference limits:
  - Max reference depth 5: a chain `A → B → C → D → E → F` is allowed, and a 6th hop → 400.
  - Max 500 distinct secrets loaded per request.
  - Max expanded value 1,048,576 UTF-8 bytes.
  - All limit errors are 400 `bad_request`.
- Authorization for a reference is checked **before** existence. A forbidden reference → 403 `forbidden`, whose message gives the referencing secret and the reference text, never the target's value and never whether it exists.
- Imports are **not transitive**: an import brings only the secrets stored directly at `(source env, source path)`.
  - Precedence: local keys win; then imports in ascending `position`, where the first import that provides a key wins.
  - Imported values expand references relative to their **source** env and path.
  - The source must be in the same project; a self-import → 400.
  - Listing with imports needs `secret:read` on every source. A forbidden source makes the whole request 403; it is never silently skipped.
- `expand` only applies when values are returned (`reveal=true` for list; always for single get). `rawValue` is present only when `expand=true` and differs from `value`.
- Folder paths in SQL `LIKE` must be escaped (`\`, `%`, `_`) with `ESCAPE '\'`. Descendant tests use `path = ? OR path LIKE ? || '/%'` on the escaped prefix, with the root `/` handled separately.
- KEK rotation:
  - Queue `anchor-reencrypt`, consumer `max_batch_size: 1`, `max_retries: 10`, dead letter queue `anchor-reencrypt-dlq`.
  - Each message re-encrypts ≤ 100 versions with a conditional `UPDATE ... WHERE secret_id=? AND version=? AND key_version=?`.
  - Old KEKs become `retired` only once **zero** versions reference them.
- Root keyring env vars:
  - `ANCHOR_ROOT_KEY` and `ANCHOR_ROOT_KEY_ID` (default `rk1`).
  - Optional `ANCHOR_ROOT_KEY_PREVIOUS` with `ANCHOR_ROOT_KEY_PREVIOUS_ID`.
  - IDs match `^[a-z0-9-]{1,32}$` and must differ; a previous key without a previous id is a `ConfigError`.
- Platform limits verified 2026-11-06 at developers.cloudflare.com/queues/platform/limits: message ≤ 128 KB, consumer batch ≤ 100, consumer wall time 15 min, default CPU 30 s. Re-check before Task 10.
- UI work loads the `dashboard-ui` skill, follows `.claude/rules/dashboard-ui.md`, and ends with the skill's "Before you finish a UI change" checklist. Values stay masked until revealed, including past versions and resolved previews.
- CLI work follows the `building-cli` skill: stdout carries data only, every command supports `--json`, destructive commands need `--yes` in non-TTY, and secret values never appear in argv.

## Review Focus

1. **References that leak through authorization.** Cases: a developer restricted to `dev` references `${prod:/DB_PASSWORD}`; a service token scoped to `/api` references `${dev:/billing/KEY}`; an import pulls from an env the caller cannot read. Each one → 403 that does not reveal the value or whether the secret exists, including when the forbidden target does not exist. Tests are in Tasks 5 and 7.
2. **Pre-M5 values that contain `${HOME}`-style text** start failing `anchor run` once expansion is on by default. The error must name the secret, the path and the reference, and suggest `$${` or `--no-expand`. `--no-expand` must work. Tests are in Tasks 5, 7 and 11.
3. **Interrupted KEK rotation.** Cases: duplicate delivery, a consumer crash mid-batch, writes and rollbacks during rotation, a rotation request while one is running. Every secret stays readable at every moment, nothing is double-encrypted, the request while running resumes instead of starting a second rotation, and the old KEK is retired only at zero remaining. Tests are in Tasks 9 and 10.
4. **Folder paths with `_`/`%` and shared prefixes.** Listing or force-deleting `/a_b` never touches `/axb`, and `/api` never touches `/apix`. Tests are in Tasks 1 and 2.
5. **Root-key rewrap misconfiguration.** Cases: missing previous key, previous id equal to the current id, the wrong previous key. Each one fails closed with 500 `internal` and a `config_error` / `secret_decrypt_failed` log, leaves no half-rewrapped rows, and a second rewrap returns `{ rewrapped: 0 }`. Tests are in Task 8.

---

## File Structure

```
packages/shared/src/
  references.ts           tokenizeValue(), formatReference(), REFERENCE limits (pure; used by server + web)
  schemas/folders.ts      folder body/query schemas (new domain file)
  schemas/imports.ts      import body schema (new domain file)
  schemas/secrets.ts      + rollback body schema, expand/includeImports query
  schemas/index.ts        + re-exports folders and imports
  api.ts                  + FolderDto, SecretVersionDto, FolderImportDto, KeyRotationDto, SecretDto fields
  audit.ts (or errors.ts) + M5 audit actions (where M2 put AUDIT_ACTIONS)
apps/server/
  migrations/0003_folders_imports.sql
  wrangler.jsonc          + queues producer/consumer, DLQ
  src/index.ts            export default { fetch, queue, scheduled }
  src/secrets/paths.ts    ancestors(), isWithin(), childSegment(), likePrefix()
  src/folders/{repo,routes}.ts
  src/secrets/versions.ts listVersions(), getVersionValue(), rollbackSecret()
  src/secrets/view.ts     composeSecrets(): local + imports + expansion for list/get
  src/references/resolve.ts  createResolver()
  src/imports/{repo,routes}.ts
  src/crypto/keyring.ts   (modify) getRootKeyring(), unwrapKek by rootKeyId, rewrapAll()
  src/keys/{rotation,queue,routes}.ts
  src/admin/routes.ts     POST /admin/root-key/rewrap
apps/cli/src/commands/
  secrets.ts (modify)     --expand/--no-expand, get --version, history, rollback
  run.ts, export.ts (modify)  expand + includeImports
  folders.ts              list/create/delete
apps/web/src/             (exact folders follow the M4 layout; Task 0 maps them)
  features/folders/       FolderRows, Breadcrumb, NewFolderSheet, DeleteFolderDialog
  features/history/       SecretHistorySheet, RollbackDialog
  features/references/    ReferenceText, ResolvedPreview
  features/imports/       ImportsSection, AddImportSheet
  features/settings/      EncryptionSection (KEK status + rotate)
docs/deploy.md            + key rotation runbook

apps/server/test/         layers per docs/testing.md; imports via #src/* and #test/support
  support/db.ts           (modify) TABLES_CHILD_FIRST + folder_imports, folders, key_rotations
  unit/secrets/paths.test.ts
  unit/references/resolve.test.ts
  integration/db/migration-0003.test.ts
  integration/keys/{rotation,queue}.test.ts
  api/folders/folders.test.ts
  api/imports/imports.test.ts
  api/secrets/{versions,expand}.test.ts
  api/admin/root-keyring.test.ts
  api/no-leak.test.ts     (modify) referenced + imported canaries
packages/shared/test/
  references.test.ts      mirrors src/references.ts
apps/cli/test/            support/ holds the helpers and fakes; imports via #test/support and #src/*
  integration/commands/{secrets-history,expand,folders}.test.ts
  e2e/m5.e2e.test.ts
apps/web/test/            no tests inside src/; support/ holds the render helpers and MSW handlers
  features/{folders,history,references,imports,settings}/*.test.tsx
  e2e/m5.spec.ts
```

---

### Task 0: Reconcile with merged M1–M4 code

**Files:**
- Modify: this plan, and only this plan

- [ ] **Step 1: List the consumed names.** Every name in an **Interfaces → Consumes** block below must exist in the merged code. Check each one: `createApp`, `AppEnv`, `Principal` (M2 union), `authorize(db, principal, action, resource)` (M2 async), `requireUser`/`requirePrincipal`, `ApiError`, `IntegrityError`, `ConfigError`, `log`, `parseJson`, `parseQuery`, `getRootKey`, `createWrappedKek`, `unwrapKek`, `kekAad`, `secretAad`, `seal`, `open`, `AEAD_ALG`, `getProjectKek`, `getProjectBySlug`, `getEnvironmentBySlug`, `putSecret`, `getSecret`, `listSecrets`, `deleteSecret`, `SecretContext`, `recordAudit` (M2 name), the test helpers `api`, `jsonInit`, `resetDb` and `createUserWithSession` (exported from `#test/support`, in `apps/server/test/support/`), plus the M2 helpers for creating members and service tokens (also under `test/support/factories/`). On the client side: the CLI API client, its output and exit-code helpers, and the web `AppShell`, the query client, MSW handlers and the primitives `Button`, `Sheet`, `Dialog`, `StatusBadge`, `Tag`.
- [ ] **Step 2: Grep each name and record its real signature.** Run `grep -rn "export .*<name>" apps packages`. Where it differs from this plan, edit this plan so later tasks use the real name. Never rename merged code to match this plan.
- [ ] **Step 3: Check what `secret_versions.created_by` holds after M2** (user id only, or a typed id) and rewrite Task 3's `createdBy` lookup to match.
- [ ] **Step 4: Map the web feature folders** to the M4 layout and update the paths in Tasks 13–17.
- [ ] **Step 5: Run the full suite.** Run `pnpm lint && pnpm typecheck && pnpm test`. Expected: green before any M5 change. Commit the plan edits with `git commit -m "docs(plan): reconcile M5 plan with merged code"`.

#### Task 0 findings (2026-11-07, against main 7da2ece)

Every consumed server name exists. Real signatures, which later tasks use:

- **Crypto (`apps/server/src/crypto/`):** `getRootKey(env): Promise<CryptoKey>`, `createWrappedKek(rootKey, projectId, version)`, `unwrapKek(rootKey, w: WrappedKek)` (rejects `rootKeyId !== ROOT_KEY_ID`), `kekAad`, `secretAad({ projectId, environmentId, secretId, version })`, `seal(key, bytes, aad)`, `open(key, { iv, ciphertext }, aad)`, `AEAD_ALG`, `importAesKey`.
- **Projects (`src/projects/repo.ts`):** `getProjectKek(db, rootKey, project, version = project.current_key_version)`, `getProjectBySlug(db, slug)`, `getEnvironmentBySlug(db, projectId, slug)`, `ProjectRow`, `EnvironmentRow`, `listEnvironments(db, projectId)`.
- **Secrets (`src/secrets/`):** `SecretContext = { db, rootKey, project, environment, actorId, now }`. `putSecret(ctx, { path, key, value, comment })` returns `{ secret, created, changed }`. `listSecrets(ctx, { path, reveal })` lists the exact path only. `getSecret(ctx, { path, key })` and `deleteSecret(ctx, { path, key })`. The repo has `findSecretWithVersion`, `listSecretsWithVersions`, and `insertSecretStatement`/`insertVersionStatement`/`setCurrentVersionStatement` (statements for one `db.batch`). Routes build the context in `secretContext(c, target, action, path)` in `src/secrets/routes.ts`.
- **Authz and audit:** `authorize(db, principal, action, { projectId, environmentId, path })` is async and throws 403. "Project admin" is the action `project:update`; instance owners and admins pass every check. `requirePrincipal(c)`, `requireUser(c)`. `recordAudit(c, { action, projectId, environmentId, target, metadata })` and `capKeys(keys)` live in `src/audit/record.ts`. Metadata keys `value`, `rawValue`, ... are rejected.
- **Shared:** `AUDIT_ACTIONS` is in `packages/shared/src/audit.ts` and pinned by `packages/shared/test/audit.test.ts`. `utf8ByteLength` is in `schemas/common.ts`. `normalizeSecretPath`, `secretPathSchema`, `secretKeySchema` and `secretQuerySchema` are in `schemas/secrets.ts`.
- **Cron:** `handleScheduled` is in `src/audit/scheduled.ts`; `src/index.ts` exports `{ fetch, scheduled }`.
- **Server test helpers (`#test/support`):** `api(path, init)` (the real Worker fetch), `json`, `jsonInit(method, body, { token | cookie })`, `resetDb`, `TABLES_CHILD_FIRST`, `createUserWithSession({ role, kind })`, `createMember(projectSlug, { role, environments })` (env slugs), `createServiceToken(projectSlug, { permission, scopes: [{ environment, path }], name? })`, `auditRows(action?)`. `createApp().request(path, init, envOverrides)` works for tests that need different bindings (as in `test/api/audit/wiring.test.ts`).
- **`secret_versions.created_by`** holds a user id for user writes and `NULL` for service-token writes (the routes pass `actorId: null` for tokens). Task 3 therefore resolves `createdBy` with a `LEFT JOIN users`, giving `{ id, label: email }` or `null` when the column is null or the user is gone. A token's name cannot be recovered from the row.
- **CLI (`apps/cli`):** `ApiClient` and `createApiClient` are in `src/api/client.ts`. `EXIT` (`USAGE` 2, `FORBIDDEN` 4, `CONFLICT` 6) and `CliError` are in `src/errors.ts`. `confirmDestructive(ctx, message)` is in `src/confirm.ts`. Commands are registered in `src/program.ts`. Tests use `fakeApi`, `apiError` and `runCli` from `#test/support`. The help snapshot is `test/unit/__snapshots__/help.test.ts.snap`, and the e2e suite is `test/e2e/cli.e2e.test.ts` with `harness.ts`.
- **Web layout (M4 has no `features/` folder).** Every `apps/web/src/features/<x>/` path in Tasks 13–17 means `apps/web/src/components/<x>/` with kebab-case file names, as in M4 (`folder-rows.tsx`, `secret-history-sheet.tsx`, ...).
  - Endpoint functions go into `src/lib/api/endpoints.ts` (`api.*`), with keys in `src/lib/api/query-keys.ts`. Hooks live beside the components.
  - Tests go in `apps/web/test/components/<x>/`. MSW handlers and fixtures are in `test/support/handlers.ts` and `test/support/fixtures.ts`.
  - The environment view is `src/routes/_app/projects/$project/environments/$env.tsx` with `-components/secrets-table.tsx` and `-components/secret-sheet.tsx`.
  - `PathBreadcrumb` already exists (`src/components/secrets/path-breadcrumb.tsx`); Task 13 reuses it instead of creating one.
  - Project settings are separate routes under `settings/`, so Task 17 adds `settings/encryption.tsx` and a sidebar link.
  - Write permission is computed inline from `ProjectDto.access`.
- **No secret value in the query cache.** M4's rule (`query-keys.ts`: "No key and no cached query ever holds a secret value") means value fetches go through plain `api.*` calls into component state (`MaskedValue`'s `reveal`), not through `useQuery`. That covers past versions (Task 14) and the resolved preview (Task 15).

---

### Task 1: Migration 0003 and path helpers

**Files:**
- Create: `apps/server/migrations/0003_folders_imports.sql`, `apps/server/src/secrets/paths.ts`
- Modify: `apps/server/test/support/db.ts` (add `folder_imports`, `folders` and `key_rotations` to `TABLES_CHILD_FIRST`, children before parents, so `resetDb` covers the new tables and `test/integration/db/reset.test.ts` stays green)
- Test: `apps/server/test/unit/secrets/paths.test.ts`, `apps/server/test/integration/db/migration-0003.test.ts`

**Interfaces:**
- Produces: these tables (spec §13.3) plus the internal columns `key_rotations.updated_at INTEGER NOT NULL` and `key_rotations.error TEXT`:

```sql
CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (environment_id, path)
);
CREATE TABLE folder_imports (
  id TEXT PRIMARY KEY,
  environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  source_environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  source_path TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (environment_id, path, source_environment_id, source_path)
);
ALTER TABLE project_keys ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active','retiring','retired'));
CREATE TABLE key_rotations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_version INTEGER NOT NULL,
  to_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  total INTEGER NOT NULL,
  done INTEGER NOT NULL,
  error TEXT,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX key_rotations_project ON key_rotations(project_id, started_at DESC);
CREATE INDEX secret_versions_key_version ON secret_versions(key_version);
```

- Produces (`paths.ts`, all pure and taking normalized paths):
  - `ancestors(path: string): string[]`: `/a/b/c` → `["/a", "/a/b", "/a/b/c"]`, and `/` → `[]`
  - `isWithin(path: string, prefix: string): boolean`: `/` contains everything; `/api` contains `/api` and `/api/x` but not `/apix`
  - `childSegment(parent: string, path: string): string | null`: the direct-child segment name of `path` under `parent`, else null
  - `likePrefix(path: string): string`: escapes `\ % _` for use with `ESCAPE '\'`

- [ ] **Step 1: Write the failing tests.**
  - Table-driven tests for all four helpers, including `isWithin("/apix", "/api") === false`, `isWithin("/a_b/c", "/a_b") === true`, `likePrefix("/a_b%") === "/a\\_b\\%"` and `childSegment("/", "/a/b") === "a"`.
  - `migration-0003.test.ts` checks that the tables exist, that `project_keys.status` defaults to `active`, and that deleting a source environment cascades its imports.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm --filter ./apps/server test:unit -- paths` and `pnpm --filter ./apps/server test:integration -- migration-0003 reset`.
- [ ] **Step 3: Implement the migration and the helpers.** Apply the migration locally with `wrangler d1 migrations apply anchor --local`.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(server): M5 schema and folder path helpers"`.

---

### Task 2: Folders API

**Files:**
- Create: `apps/server/src/folders/repo.ts`, `apps/server/src/folders/routes.ts`
- Modify: `apps/server/src/secrets/service.ts` (`putSecret` ensures folder rows), `apps/server/src/app.ts`, `packages/shared/src/schemas/index.ts` (re-export), `packages/shared/src/api.ts`, plus the audit action list
- Create (shared): `packages/shared/src/schemas/folders.ts`
- Test: `apps/server/test/api/folders/folders.test.ts`

**Interfaces:**
- Consumes: `ancestors`, `isWithin`, `childSegment`, `likePrefix` (Task 1); `authorize`; `recordAudit`.
- Produces (shared): `FolderDto { path: string; name: string }`, `createFolderBodySchema { path: secretPathSchema }` (`/` → 400), `deleteFolderQuerySchema { path, force: "true"|"false" → boolean = false }`.
- Produces (repo):
  - `ensureFolders(db, environmentId, path, now): D1PreparedStatement[]` returns `INSERT OR IGNORE` statements for every ancestor, so callers can add them to their batch.
  - `listChildFolders(db, environmentId, parent): Promise<FolderDto[]>` takes the union of `folders.path` and `DISTINCT secrets.path` under `parent` (via `likePrefix`), maps them through `childSegment`, de-duplicates, and sorts by name.
  - `deleteFolder(db, environmentId, path, force): Promise<{ secretsDeleted: number; foldersDeleted: number }>`
- Produces (routes on `/api/v1/projects/:project/environments/:env/folders`):
  - `GET ?path=` → `{ folders }` (`secret:read` on `{ environmentId, path }`)
  - `POST {path}` → 201 `{ folder }` (`secret:write`). Creates ancestors; an existing folder → 200.
  - `DELETE ?path=&force=` → 204 (`secret:write`).
    - When the subtree holds secrets, subfolders or imports targeting it and `force` is false → 409 `conflict` "Folder is not empty".
    - `force=true` deletes the secrets (versions cascade), the folder rows and the `folder_imports` rows whose `path` is within the folder, all in one `db.batch`.
    - Deleting `/` → 400.
- Audit: `folder.created { path }` and `folder.deleted { path, secretsDeleted, foldersDeleted }`.

- [ ] **Step 1: Write the failing tests:**
  - `lists children from secrets written before M5 without folder rows`: insert secrets at `/api/db` via SQL only, then `GET ?path=/` → `[{ path: "/api", name: "api" }]`
  - `create makes all ancestors and is idempotent`
  - `putSecret at /x/y creates folder rows /x and /x/y`
  - `delete non-empty -> 409; force deletes subtree only` (Review Focus 4): create `/api`, `/apix` and `/a_b`/`/axb` with secrets, force-delete `/api` and `/a_b`, then expect `/apix` and `/axb` and their secrets intact
  - `delete / -> 400`, `invalid path -> 400`
  - `service token scoped to /api: list ?path=/ -> 403, list ?path=/api -> 200` (uses the M2 token helper from `#test/support`)
  - `viewer -> 403 on create/delete`
  - `audit records folder.deleted with counts`
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement the repo, the routes and the `putSecret` change** (add the `ensureFolders` statements to its existing batch).
- [ ] **Step 4: Run the tests and confirm they pass.** Also run the whole server suite, because `putSecret` changed.
- [ ] **Step 5: Commit** with `git commit -m "feat(folders): folder listing, creation and guarded deletion"`.

---

### Task 3: Version history, past-version reveal and rollback

**Files:**
- Create: `apps/server/src/secrets/versions.ts`
- Modify: `apps/server/src/secrets/routes.ts`, `packages/shared/src/schemas/secrets.ts`, `packages/shared/src/api.ts`
- Test: `apps/server/test/api/secrets/versions.test.ts`

**Interfaces:**
- Consumes: `SecretContext`, `getProjectKek(db, rootKey|keyring, project, version)`, `secretAad`, `open`, `putSecret`, `IntegrityError`, `recordAudit`.
- Produces (shared): `SecretVersionDto { version; comment; createdAt; createdBy: { id: string; label: string } | null }`, `rollbackBodySchema { path: secretPathSchema = "/", version: int ≥ 1 }`.
- Produces (`versions.ts`):
  - `listVersions(ctx, { path, key }): Promise<SecretVersionDto[]>` returns versions newest first. `label` is the user's email or the token's name; a missing actor gives `null`.
  - `getVersionValue(ctx, { path, key, version }): Promise<SecretVersionDto & { value: string }>` decrypts with that row's `key_version` KEK and AAD version = that version. An unknown version → 404 "Version not found".
  - `rollbackSecret(ctx, { path, key, version }): Promise<{ secret: SecretDto; changed: boolean }>` calls `putSecret` with the old value and comment. That produces a new version under the current KEK with new AAD. When the content equals the current content → `changed: false`.
- Produces (routes):
  - `GET …/secrets/:key/versions?path=` → `{ versions }` (`secret:read`)
  - `GET …/secrets/:key/versions/:version?path=` → `{ version }` (`secret:read`, audit `secret.version_read { path, key, version }`)
  - `POST …/secrets/:key/rollback` → 200 `{ secret }` (`secret:write`, audit `secret.rolled_back { path, key, fromVersion: <current>, toVersion: <version>, newVersion }` only when changed)

- [ ] **Step 1: Write the failing tests:**
  - `lists versions newest first without values`
  - `reveals a past version byte-exact`
  - `rollback creates version n+1 equal to the old value and comment`
  - `rollback to current content is a no-op 200 with no new row`
  - `rolled-back version decrypts after its source version row is deleted`: proves the new AAD is used
  - `past version encrypted under an older KEK still reveals`: rotate the KEK manually in SQL with `createWrappedKek` v2 and `current_key_version=2`, then reveal v1
  - `unknown version -> 404`, `version 0 / "abc" -> 400`
  - `viewer can list and reveal but not rollback (403)`; `dev-only member cannot reveal prod history (403)`
  - `audit has secret.version_read without the value`
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement the service and the routes.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(secrets): version history, past-version reveal and rollback"`.

---

### Task 4: Reference tokenizer (shared, pure)

**Files:**
- Create: `packages/shared/src/references.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/references.test.ts`

**Interfaces:**
- Produces:
  - `type RefTarget = { environment: string | null; path: string | null; key: string }`. When `environment` is null, the target is the same env and path.
  - `type ValueToken = { type: "text"; text: string } | { type: "ref"; raw: string; target: RefTarget; start: number; end: number }`
  - `tokenizeValue(value: string): ValueToken[]`. Adjacent text is merged, and `$${` turns into the text `${`.
  - `formatReference(t: RefTarget): string`
  - `REFERENCE_LIMITS = { maxDepth: 5, maxSecrets: 500, maxExpandedBytes: 1_048_576 } as const`
- The grammar is in Global Constraints. Use one regex with sticky/global scanning. The path inside a reference goes through `normalizeSecretPath`; an invalid path makes the whole `${...}` literal text.

- [ ] **Step 1: Write the failing tests.** Use these cases verbatim:

```ts
it.each([
  ["plain", [{ type: "text", text: "plain" }]],
  ["${DB}", [{ type: "ref", raw: "${DB}", target: { environment: null, path: null, key: "DB" } }]],
  ["x${prod:/DB_URL}y", ["x", { environment: "prod", path: "/", key: "DB_URL" }, "y"]],
  ["${prod:/db/PASSWORD}", [{ environment: "prod", path: "/db", key: "PASSWORD" }]],
  ["$${DB}", [{ type: "text", text: "${DB}" }]],
  ["$$${DB}", [{ type: "text", text: "$${DB}" }]],   // "$" + escaped "$${" -> "${" ; merged text, no ref
  ["${VAR:-x}", [{ type: "text", text: "${VAR:-x}" }]],
  ["${a b}", [{ type: "text", text: "${a b}" }]],
  ["${Prod:/X}", [{ type: "text", text: "${Prod:/X}" }]],   // env slug must be lowercase
  ["${prod:/../X}", [{ type: "text", text: "${prod:/../X}" }]],
  ["${prod:X}", [{ type: "text", text: "${prod:X}" }]],     // path must start with /
  ["${", [{ type: "text", text: "${" }]],
  ["${A}${B}", ["ref A", "ref B"]],
])("%s", ...);
it("formatReference round-trips through tokenizeValue", ...);
it("tokenizes a 64 KiB value with 2,000 references in < 50 ms", ...);
```

The `$$${DB}` case pins the scanning order. Scan left to right; the first `$${` match starts at index 1. The result is the text `$` plus a literal `${` plus `DB}`, merged into one text token. Rows written as shorthand (`"x"`, `"ref A"`, bare targets) must be expanded into full `ValueToken` objects with `raw`, `start` and `end`.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(shared): secret reference tokenizer"`.

---

### Task 5: Reference resolver (server)

**Files:**
- Create: `apps/server/src/references/resolve.ts`
- Test: `apps/server/test/unit/references/resolve.test.ts` (pure unit tests with in-memory loaders; no D1)

**Interfaces:**
- Consumes: `tokenizeValue`, `REFERENCE_LIMITS`, `utf8ByteLength`, `ApiError`.
- Produces:
  - `type SecretAddress = { environment: string; path: string; key: string }` (env slug)
  - `type ResolverDeps = { authorize(addr: SecretAddress): Promise<void>; load(addr: SecretAddress): Promise<string | null> }`. `authorize` throws `ApiError` 403. `load` returns the decrypted raw value, or null when it is missing.
  - `createResolver(deps: ResolverDeps): { expand(origin: SecretAddress, raw: string): Promise<{ value: string; referenced: SecretAddress[] }> }`
- Algorithm (pinned):
  - Do a depth-first expansion with a stack of addresses for cycle detection and a per-resolver memo `Map<addrKey, expanded>`. The memo makes the diamond `A → B, C → D` load D once.
  - For each ref token:
    1. Resolve the relative address (same env and path as the secret that contains the token).
    2. Call `authorize`.
    3. Call `load`; a null result → `ApiError(400, "bad_request", "Unresolved reference ${raw} in <env>:<path>/<KEY>; escape a literal with $${")`.
    4. Recurse.
  - Error messages:
    - A cycle → 400 `"Reference cycle: dev:/A -> dev:/B -> dev:/A"`.
    - Depth over `maxDepth` → 400 `"Reference depth exceeds 5 at <addr>"`.
    - More than `maxSecrets` distinct loads → 400.
    - Any intermediate or final string over `maxExpandedBytes` → 400 `"Expanded value exceeds 1048576 bytes"`.
  - `referenced` lists every address loaded, without duplicates.

- [ ] **Step 1: Write the failing tests:**
  - `expands same-folder and cross-env references`
  - `escaped $${ stays literal and is not loaded` (the `load` spy is not called)
  - `missing target -> 400 naming secret and reference with escape hint` (Review Focus 2)
  - `forbidden target -> 403 and load is never called` (Review Focus 1, authorization before existence)
  - `forbidden and missing target -> 403, not 400` (Review Focus 1: no existence oracle)
  - `self reference ${A} in A -> 400 cycle`, `A->B->A -> 400 cycle listing the path`
  - `depth 5 chain ok, depth 6 -> 400`
  - `diamond loads D once`
  - `doubling chain (A=${B}${B}, B=${C}${C} … with 64 KiB leaf) -> 400 size, not OOM`
  - `501 distinct references -> 400`
  - `referenced lists unique addresses`
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement `createResolver`.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(references): resolver with authz-first lookup, cycle, depth and size limits"`.

---

### Task 6: Folder imports — storage and API

**Files:**
- Create: `apps/server/src/imports/repo.ts`, `apps/server/src/imports/routes.ts`, `packages/shared/src/schemas/imports.ts`
- Modify: `apps/server/src/app.ts`, `packages/shared/src/schemas/index.ts` (re-export), `packages/shared/src/api.ts`, plus the audit actions
- Test: `apps/server/test/api/imports/imports.test.ts`

**Interfaces:**
- Produces (shared): `FolderImportDto { id; path; source: { environment: string; path: string }; position: number }`, `createImportBodySchema { path: secretPathSchema = "/", source: { environment: slugSchema, path: secretPathSchema } }`.
- Produces (repo):
  - `listImports(db, environmentId, path): Promise<ImportRow[]>` (ordered by position)
  - `createImport(db, { environmentId, path, sourceEnvironmentId, sourcePath }, now)` sets position to max + 1. A duplicate → 409. When source equals target → 400 "A folder cannot import itself".
  - `deleteImport(db, environmentId, id)`: 404 when the import is unknown or in another env
- Produces (routes on `/api/v1/projects/:project/environments/:env/imports`):
  - `GET ?path=` → `{ imports }` (`secret:read` on the target)
  - `POST` → 201 `{ import }`. Needs `secret:write` on the target and `secret:read` on the source; a source env in another project → 404.
  - `DELETE /:id` → 204 (`secret:write` on the import's target path)
- Audit: `import.created { path, source }` and `import.deleted`.

- [ ] **Step 1: Write the failing tests:**
  - `create, list ordered by position, delete`
  - `duplicate -> 409`, `self import -> 400`, `unknown source env -> 404`
  - `creating an import from an env the member cannot read -> 403` (Review Focus 1)
  - `viewer cannot create (403)`
  - `deleting the source env removes the import`
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(imports): folder import storage and API"`.

---

### Task 7: Composed secret reads — imports and expansion over HTTP

**Files:**
- Create: `apps/server/src/secrets/view.ts`
- Modify: `apps/server/src/secrets/routes.ts`, `packages/shared/src/schemas/secrets.ts` (`secretQuerySchema` gets `expand` and `includeImports` booleans, default false; and `packages/shared/src/api.ts` (`SecretDto` gets `rawValue?: string` and `importedFrom?: { environment: string; path: string }`)
- Test: `apps/server/test/api/secrets/expand.test.ts`

**Interfaces:**
- Consumes: `createResolver` (Task 5), `listImports` (Task 6), `listSecrets`/`getSecret` (M1), `authorize`, `recordAudit`.
- Produces: `composeSecrets(ctx: SecretContext & { principal: Principal }, opts: { path: string; reveal: boolean; expand: boolean; includeImports: boolean }): Promise<{ secrets: SecretDto[]; referenced: SecretAddress[] }>` and `composeSecret(ctx, { path, key, expand, includeImports }): Promise<{ secret: SecretDto; referenced: SecretAddress[] }>`.
  - With `includeImports`, the result is:
    - local secrets
    - imported secrets whose key is not taken by a local secret or an earlier import, marked `importedFrom`
  - Imported entries are read-only in the UI. `PUT`/`DELETE` keep addressing only local secrets.
  - Before reading any import source, `authorize(db, principal, "secret:read", { projectId, environmentId: src, path: srcPath })`. A failure → 403 for the whole request.
  - With `expand`, every returned value goes through one resolver instance per request. Its `load` decrypts via the M1 service (KEK cache per request) and its `authorize` uses the caller's principal. An imported value expands relative to its source address.
  - `secret.read` audit metadata gains `referenced: { environment, path, key }[]` and `imports: { environment, path }[]`.
- Routes: `GET …/secrets` and `GET …/secrets/:key` accept `expand` and `includeImports`. A single get with `includeImports=true` may return an imported key (with `importedFrom`).

- [ ] **Step 1: Write the failing HTTP tests:**
  - `expand=true returns expanded value and rawValue; without expand only raw value`
  - `list without reveal ignores expand and returns no values`
  - `local key overrides import; earlier import wins over later`
  - `imports are not transitive`: B imports C, A imports B → A does not see C's keys
  - `imported value with ${KEY} resolves in the source folder, not the importing one`
  - `developer restricted to dev: expand of ${prod:/DB_PASSWORD} -> 403 and body contains neither the value nor "not found"` (Review Focus 1)
  - `service token scoped to /api: ${dev:/billing/KEY} -> 403; includeImports from /billing -> 403` (Review Focus 1)
  - `value "echo ${HOME}" with expand -> 400 naming secret, reference and $${ hint; without expand -> 200` (Review Focus 2)
  - `audit secret.read lists referenced addresses and no values`
  - `no-leak`: extend the M1 canary test in `apps/server/test/api/no-leak.test.ts` with a referenced canary value and an imported one, and assert neither appears in logs
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement `view.ts` and wire up the routes.**
- [ ] **Step 4: Run the tests and confirm they pass.** Then run the full server suite.
- [ ] **Step 5: Commit** with `git commit -m "feat(secrets): imports and reference expansion on read"`.

---

### Task 8: Root keyring and KEK re-wrap

**Files:**
- Modify: `apps/server/src/crypto/keyring.ts`, `apps/server/src/env.ts` (bindings), `apps/server/src/projects/repo.ts` (callers), `apps/server/vitest.config.ts` (test binding `ANCHOR_ROOT_KEY_ID: "rk-test"`), `apps/server/.dev.vars.example`, `docs/deploy.md`
- Create: `apps/server/src/admin/routes.ts`
- Test: `apps/server/test/api/admin/root-keyring.test.ts`

**Interfaces:**
- Produces:
  - `type RootKeyring = { current: { id: string; key: CryptoKey }; previous: { id: string; key: CryptoKey } | null }`
  - `getRootKeyring(env): Promise<RootKeyring>` validates per Global Constraints and throws `ConfigError` naming the variable, never the value. It replaces `getRootKey` at every call site.
  - `createWrappedKek(keyring, projectId, version)` wraps with `keyring.current` and sets `rootKeyId = current.id`.
  - `unwrapKek(keyring, w)` picks the key by `w.rootKeyId`; an unknown id → `IntegrityError("kek unwrap failed", { projectId, kekVersion })`.
  - `rewrapAllKeks(db, keyring, now): Promise<number>` selects `project_keys` rows with `root_key_id != current.id` in pages of 100. For each it unwraps the raw bytes with the matching key, seals them with current (same `kekAad`), and runs `UPDATE ... WHERE project_id=? AND version=? AND root_key_id=<old>`. It returns the number of rows updated. It decrypts every row in a page before writing any, so a bad row aborts the page with nothing written.
  - Raw KEK bytes exist only inside `rewrapAllKeks`. Add `unwrapKekBytes` as a non-exported helper.
- Routes: `POST /api/v1/admin/root-key/rewrap` → `{ rewrapped }`, instance owner only (others 403). Audit `root_key.rewrapped { count, toKeyId }`.
- Docs: `docs/deploy.md` gets a "Rotating the root key" runbook:
  1. Generate the new key.
  2. Set `ANCHOR_ROOT_KEY_PREVIOUS` and `_PREVIOUS_ID` to the old values.
  3. Set `ANCHOR_ROOT_KEY` and `ANCHOR_ROOT_KEY_ID` to the new ones.
  4. Deploy.
  5. Call the rewrap endpoint.
  6. Confirm it returned the expected count, then run it again and expect `0`.
  7. Remove the previous key.
  8. Back up the new key offline.

- [ ] **Step 1: Write the failing tests** (use `createApp().request(path, init, { ...env, ...overrides })`):
  - `existing data decrypts after rotation with previous key configured`: create a project and secret under `rk-test`, switch env to new current `rk2` + previous `rk-test`, then read the secret
  - `rewrap converts all rows and second call returns 0` (Review Focus 5)
  - `after rewrap, previous key can be removed and data still decrypts`
  - `previous key without previous id -> 500 internal, config_error logged`; `previous id equal to current id -> 500` (Review Focus 5)
  - `wrong previous key -> rewrap 500, secret_decrypt_failed logged, zero rows changed` (Review Focus 5)
  - `unknown root_key_id on a row -> IntegrityError on read`
  - `non-owner admin -> 403`
  - `response and logs never contain base64 key material`
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.** Update all `getRootKey` callers, and keep the module-level import cache keyed by the raw strings.
- [ ] **Step 4: Run the tests and confirm they pass.** Run the full server suite (keyring callers changed).
- [ ] **Step 5: Commit** with `git commit -m "feat(crypto): root keyring with previous key and KEK rewrap"`.

---

### Task 9: KEK rotation — start, resume and status

**Files:**
- Create: `apps/server/src/keys/rotation.ts`, `apps/server/src/keys/routes.ts`
- Modify: `apps/server/src/projects/repo.ts` (`getProjectKek` accepts the keyring and allows decrypting with `retiring`/`retired` KEKs, logging `retired_kek_used` for retired ones), `apps/server/src/env.ts` (`REENCRYPT_QUEUE: Queue<ReencryptMessage>`), `packages/shared/src/api.ts`
- Test: `apps/server/test/integration/keys/rotation.test.ts`

**Interfaces:**
- Produces (shared): `KeyRotationDto` (spec §13.5) and `ProjectKeyDto { version: number; status: "active" | "retiring" | "retired"; rootKeyId: string; createdAt: number }`.
- Produces:
  - `type ReencryptMessage = { type: "reencrypt"; rotationId: string; projectId: string; toVersion: number }`
  - `startOrResumeRotation(db, keyring, queue: Queue<ReencryptMessage>, project: ProjectRow, now): Promise<{ rotation: KeyRotationDto; resumed: boolean }>`
    - When a `running` rotation exists, re-send its message and return it with `resumed: true`.
    - Otherwise, in one `db.batch`: insert KEK `n+1` (active), set the older active KEK to `retiring`, update `projects.current_key_version = n+1`, and insert `key_rotations` (`total` = the count of the project's versions with `key_version != n+1`, `done = 0`, status `running`). Then send the message.
    - When `total = 0`, complete immediately: status `completed`, old keys `retired`, and no message.
    - A send failure leaves the rotation `running`. The cron sweep (Task 10) or the next POST resumes it.
  - `processRotationBatch(db, keyring, msg: ReencryptMessage, now): Promise<"more" | "done" | "failed">`
    - Select ≤ 100 of the project's versions with `key_version != toVersion`. For each: decrypt with its KEK and AAD, then seal with KEK `toVersion` and the same AAD (same secretId and version).
    - Write with a batch of conditional updates `... AND key_version = <old>`, so a concurrent duplicate delivery updates 0 rows and does no harm.
    - Then `UPDATE key_rotations SET done = total - <remaining>, updated_at`.
    - When the remaining count is 0: set all KEKs `< toVersion` to `retired`, set the rotation to `completed` with `finished_at`, and audit `kek.rotation_finished`.
    - On a decrypt failure: set status `failed` with `error = "decrypt_failed"`, log `secret_decrypt_failed` with ids, and return `"failed"`.
  - `getKeyStatus(db, projectId): Promise<{ keys: ProjectKeyDto[]; rotations: KeyRotationDto[] }>` returns the last 10 rotations.
- Routes:
  - `POST /api/v1/projects/:p/keys/rotate` → 202 `{ rotation }` (project admin, i.e. `project:update`; audit `kek.rotation_started` only when not resumed)
  - `GET /api/v1/projects/:p/keys` → `{ keys, rotations }`
- Tests use a fake queue `{ send: vi.fn() }` and call `processRotationBatch` directly.

- [ ] **Step 1: Write the failing tests:**
  - `rotate creates v2, marks v1 retiring, new writes use v2`
  - `250 versions: three batches -> done; v1 retired only after the last` (Review Focus 3)
  - `every secret readable after each batch` (Review Focus 3): read all values between batches
  - `duplicate delivery of the same message is harmless`: run the same batch twice concurrently with `Promise.all` and expect values intact and `done` correct
  - `write during rotation lands on v2 and is not re-processed`
  - `rollback during rotation reads a v1 row and writes v2`
  - `rotate while running -> 202 same rotation, resumed, message re-sent, no new KEK` (Review Focus 3)
  - `project with zero secrets completes immediately`
  - `tampered row -> rotation failed, other rows untouched, status shows error`
  - `developer -> 403`; `GET keys shows versions, statuses and progress`
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(keys): KEK rotation start, resume and batch re-encryption"`.

---

### Task 10: Queue consumer, wrangler config and cron sweep

**Files:**
- Create: `apps/server/src/keys/queue.ts`
- Modify: `apps/server/src/index.ts`, `apps/server/wrangler.jsonc`, the M2 cron handler file, `docs/deploy.md`
- Test: `apps/server/test/integration/keys/queue.test.ts`

**Interfaces:**
- Produces: `handleReencryptBatch(batch: MessageBatch<ReencryptMessage>, env: Bindings): Promise<void>`. For each message it calls `processRotationBatch`:
  - `"more"`: send the same message again, then `msg.ack()`.
  - `"done"` or `"failed"`: `msg.ack()`.
  - A thrown error: `msg.retry()`. After `max_retries` the platform routes the message to the DLQ.
- Produces: `index.ts` exports `{ fetch: app.fetch, queue: handleReencryptBatch, scheduled }`.
- Produces: the cron sweep, added to the existing daily `scheduled` handler. It re-sends a message for every `running` rotation with `updated_at < now - 15 min`.
- Config: add `queues: { producers: [{ binding: "REENCRYPT_QUEUE", queue: "anchor-reencrypt" }], consumers: [{ queue: "anchor-reencrypt", max_batch_size: 1, max_retries: 10, dead_letter_queue: "anchor-reencrypt-dlq" }] }` to `wrangler.jsonc`. **Verify the key names against current docs** (developers.cloudflare.com/queues/configuration/configure-queues/) before writing them. The docs fetch failed while this plan was written.
- Docs: `docs/deploy.md` adds `wrangler queues create anchor-reencrypt` and `wrangler queues create anchor-reencrypt-dlq` before the first deploy, and a "Rotating a project key" section.

- [ ] **Step 1: Write the failing tests.**
  - Build a `MessageBatch` with `createMessageBatch` and read results with `getQueueResult` from `cloudflare:test` if the installed `@cloudflare/vitest-plugin` exports them (check its types). Otherwise, build a fake batch object whose `ack`/`retry` are `vi.fn()`.
  - `"more" re-enqueues and acks`, `"done" acks without re-enqueue`, `thrown error -> retry, not ack`, `failed -> ack, rotation failed`
  - `cron sweep re-enqueues stale running rotations only`
  - `end-to-end with the real queue binding in miniflare: rotate 150 versions, drain the queue, expect completed` (skip with a clear `it.skip` reason only if miniflare cannot drain the queue in tests, and record that in the commit message)
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement, configure and document.** Run `pnpm --filter ./apps/server exec wrangler deploy --dry-run` to confirm the config parses.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(keys): re-encryption queue consumer and stale rotation sweep"`.

---

### Task 11: CLI — expansion flags, history, past versions and rollback

**Files:**
- Modify: `apps/cli/src/commands/secrets.ts`, `apps/cli/src/commands/run.ts`, `apps/cli/src/commands/export.ts`, the CLI API client
- Test: `apps/cli/test/integration/commands/secrets-history.test.ts`, `apps/cli/test/integration/commands/expand.test.ts` (both run through `runCli` with the fakes from `#test/support`), help snapshots

**Interfaces:**
- Consumes: the M3 API client, the output and exit-code helpers, the confirm helper, and the fake API client used in tests (`apps/cli/test/support/fakes.ts`).
- Produces:
  - `run` and `export`: `--expand` (default) and `--no-expand`. Requests send `reveal=true&expand=<bool>&includeImports=true`.
  - `secrets get KEY`: `--expand` defaults on, plus `--no-expand` and `--version <n>`. `--version` calls the versions endpoint and keeps M3's reveal rules (`--plain`/non-TTY).
  - `secrets history KEY [--path] [--json]`: a table of version, comment, author and date. With `--json` it prints an array of `SecretVersionDto`.
  - `secrets rollback KEY --to <n> [--path] [--yes]`:
    - TTY: confirm "Roll back KEY in <env>:<path> to version n?". In non-TTY without `--yes` → exit 2.
    - Prints "Rolled back to vN (new version vM)" to stderr, or "Already at that content" when unchanged. With `--json` it prints `{ secret, changed }` to stdout.
  - API 400 errors from expansion print the server message, including the `$${` hint, then "Use --no-expand to skip reference expansion." and exit 1.

- [ ] **Step 1: Write the failing tests** (fake API client):
  - `run sends expand=true by default and expand=false with --no-expand`
  - `run fails closed on 400 unresolved reference: child not spawned, exit 1, hint printed` (Review Focus 2)
  - `run on 403 forbidden reference exits 4 without spawning`
  - `get --version 2 prints the value only with --plain or non-TTY`
  - `history --json is valid JSON array`
  - `rollback non-TTY without --yes -> exit 2 and no API call`
  - `rollback --yes prints the new version to stderr; --json prints to stdout`
  - Update the `--help` snapshots.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm --filter ./apps/cli test:integration`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(cli): reference expansion flags, history and rollback"`.

---

### Task 12: CLI — folders commands

**Files:**
- Create: `apps/cli/src/commands/folders.ts`
- Modify: the CLI command registry and API client
- Test: `apps/cli/test/integration/commands/folders.test.ts`, help snapshots

**Interfaces:**
- Produces:
  - `folders list [--path /] [--json]`: names one per line. With `--json` it prints `FolderDto[]`.
  - `folders create <path> [--json]`
  - `folders delete <path> [--force] [--yes]`:
    - Confirm in TTY. In non-TTY without `--yes` → exit 2.
    - A 409 without `--force` → exit 6 with "Folder is not empty. Re-run with --force to delete its secrets and subfolders."
    - With `--force`, the confirmation text says secrets will be deleted.

- [ ] **Step 1: Write the failing tests:**
  - `list prints names; --json valid`
  - `create normalizes "api/" to "/api" in the request`
  - `delete non-empty without --force -> exit 6 with hint`
  - `delete non-TTY without --yes -> exit 2, no request`
  - `--force --yes sends force=true`
  - Snapshot `--help`.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(cli): folders commands"`.

---

### Task 13: Web — folders in the environment view

**Files:**
- Create: `apps/web/src/features/folders/{FolderRows,PathBreadcrumb,NewFolderSheet,DeleteFolderDialog}.tsx`, `apps/web/src/features/folders/api.ts`
- Modify: the M4 environment secrets route (path in the URL search param `path`), the MSW handlers (`apps/web/test/support/`)
- Test: `apps/web/test/features/folders/*.test.tsx`

**Interfaces:**
- Consumes: the M4 `AppShell`, the query client and the primitives (`Button` variants, `Sheet`, `Dialog`, the table container).
- Produces:
  - `useFolders(project, env, path)`, `useCreateFolder()`, `useDeleteFolder()` (TanStack Query, which invalidates the folder and secret lists)
  - **Toolbar:** a `PathBreadcrumb` above the toolbar (root `/`; segments are path chips per `components.md`). The primary "Add secret" becomes a split button whose ▾ offers "New folder".
  - **Folder rows:** rendered first in the secrets table with a `RiFolder3Line size-4 text-text-soft` icon. The primary column shows the name over the path (`text-code-xs text-text-soft`). Clicking a row navigates into the folder.
  - **Row menu:** the `⋮` menu has "Delete folder". The confirm `Dialog` uses the `error` variant and names the folder.
    - On a 409, the dialog switches to a force confirmation: "Delete `/api` and everything in it".
  - Loading, empty ("No secrets or folders in /api") and filtered-empty states.

- [ ] **Step 1: Write the failing component tests** (MSW):
  - `renders folder rows before secrets and navigates on click`
  - `breadcrumb segments link to ancestors`
  - `new folder sheet validates path with shared schema`
  - `delete 409 shows force confirmation naming the folder`
  - `empty state copy names the path`
- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm --filter ./apps/web test`.
- [ ] **Step 3: Implement.** Then run the dashboard-ui checklist greps on the diff.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(web): folder navigation and management"`.

---

### Task 14: Web — history sheet and rollback

**Files:**
- Create: `apps/web/src/features/history/{SecretHistorySheet,RollbackDialog}.tsx`, `apps/web/src/features/history/api.ts`
- Modify: the secret row `⋮` menu (adds "History")
- Test: `apps/web/test/features/history/*.test.tsx`

**Interfaces:**
- Produces: `useSecretVersions(...)`, `useSecretVersionValue(..., version, { enabled })` (fetched only on reveal, with `gcTime: 0`, so values are not kept in the cache), and `useRollback()`.
- A right `Sheet` titled "History · KEY". Each version row shows `vN`, the comment, the author label and the absolute date with a relative tooltip.
  - Values are masked as `••••••••`; ghost reveal and copy buttons appear on hover. Reveal fetches the value; hiding drops it from component state.
  - "Roll back to vN" opens the confirm `Dialog` with a primary action.
    - On success: toast "Rolled back to vN" and invalidate the secret queries. The current version row is labeled with a `StatusBadge status="success"` "Current".
  - Only users with write permission see "Roll back". The permission hint comes from the M4 permission helper.

- [ ] **Step 1: Write the failing tests:**
  - `lists versions newest first with current badge`
  - `value not requested until reveal clicked`: the MSW spy records zero value calls
  - `rollback confirm posts version and shows toast`
  - `viewer does not see rollback action`
  - `loading and empty states`
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.** Then run the dashboard-ui checklist on the diff.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(web): secret history and rollback"`.

---

### Task 15: Web — reference highlighting and resolved preview

**Files:**
- Create: `apps/web/src/features/references/{ReferenceText,ResolvedPreview}.tsx`
- Modify: the M4 secret value editor (Sheet) and the revealed-value cell
- Test: `apps/web/test/features/references/*.test.tsx`

**Interfaces:**
- Consumes: `tokenizeValue`, `formatReference` from `@anchor/shared`.
- Produces:
  - `ReferenceText({ value })` renders text tokens as plain `text-code-xs` and ref tokens as path/key chips (`components.md` path chip), with a tooltip giving the target `env:path/KEY`. `$${` displays as a literal `${` with no chip.
  - `ResolvedPreview({ project, env, path, secretKey })` sits under the value editor for saved secrets that contain references. It is masked by default; "Show resolved value" calls `GET …/secrets/:key?expand=true`.
    - A 400/403 shows the server message as error hint text (`text-error-base text-paragraph-xs`). A 403 never shows anything beyond that message.
  - Revealed values in the table render through `ReferenceText` (raw) until "Show resolved" is chosen.

- [ ] **Step 1: Write the failing tests:**
  - `highlights ${KEY} and ${prod:/db/P} as chips; $${X} stays text`
  - `resolved preview masked until requested`
  - `400 unresolved shows server message with $${ hint`
  - `403 shows forbidden message and no value`
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.** Then run the dashboard-ui checklist.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(web): reference highlighting and resolved preview"`.

---

### Task 16: Web — imports panel

**Files:**
- Create: `apps/web/src/features/imports/{ImportsSection,AddImportSheet}.tsx`, `apps/web/src/features/imports/api.ts`
- Modify: the environment secrets route (the list query adds `includeImports=true`)
- Test: `apps/web/test/features/imports/*.test.tsx`

**Interfaces:**
- Produces: `useImports`, `useCreateImport`, `useDeleteImport`.
  - **Imports section:** above the table, with the section label "Imported from" (`text-paragraph-sm text-text-soft`). It holds one compact row per import (source `Tag` `prod:/shared`, position, `⋮` remove with confirm). It is hidden when there are no imports, and the split-button ▾ offers "Add import".
  - **Add import sheet:** env select (the project's envs) and a path input validated with `secretPathSchema`. A 409 or 400 shows the server message inline.
  - **Imported rows:** carry a `Tag` "from prod:/shared". They are read-only: no inline edit or delete, and a tooltip says "Edit in prod:/shared".
  - **A 403 on the list** (the caller cannot read a source) shows an error empty state naming the source from the server message, rather than a partial table.

- [ ] **Step 1: Write the failing tests:**
  - `imported rows tagged and read-only`
  - `local key shadows imported key (only local row shown)`
  - `add import validates path and posts`
  - `403 from list renders error state, not partial rows`
  - `remove import confirms and invalidates`
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.** Then run the dashboard-ui checklist.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(web): folder imports panel"`.

---

### Task 17: Web — encryption settings with KEK rotation status

**Files:**
- Create: `apps/web/src/features/settings/EncryptionSection.tsx`, `apps/web/src/features/settings/keys-api.ts`
- Modify: the M4 project settings route
- Test: `apps/web/test/features/settings/EncryptionSection.test.tsx`

**Interfaces:**
- Produces:
  - `useProjectKeys(project)`: `refetchInterval: 3000` while the latest rotation is `running`, else off
  - `useRotateKey()`
- **Encryption section:** the section label "Encryption", then a table of key versions showing version, a status badge (active→success, retiring→warning, retired→neutral), the root key id and the created date.
- **Rotations list:** status badges (running→info with "done / total", completed→success, failed→error with the error code).
- **"Rotate key":** a secondary button with a confirm `Dialog` explaining that values are re-encrypted in the background and stay readable. Shown to project admins only.
- **A running rotation:** the button reads "Resume rotation" (spec: POST resumes).

- [ ] **Step 1: Write the failing tests:**
  - `shows key versions with mapped badges`
  - `polls while running and stops when completed` (fake timers + MSW sequence)
  - `rotate confirm posts and shows running progress`
  - `running rotation shows Resume rotation`
  - `non-admin does not see rotate`
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.** Then run the dashboard-ui checklist.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(web): encryption settings and key rotation status"`.

---

### Task 18: End-to-end check and docs

**Files:**
- Modify: the M4 Playwright suite (add `apps/web/test/e2e/m5.spec.ts`), the M3 CLI e2e suite, `README.md` (feature list), `docs/deploy.md` (link the runbooks)
- Test: `apps/web/test/e2e/m5.spec.ts`, `apps/cli/test/e2e/m5.e2e.test.ts`

- [ ] **Step 1: Write the e2e tests:**
  - **Playwright against `wrangler dev`:**
    - Create a folder `/db`, add `PASSWORD`, then add `DB_URL` = `postgres://u:${PASSWORD}@h/db` at `/db`.
    - Show the resolved preview, open History, roll back, and see version 3.
  - **CLI e2e:**
    - `anchor run --path /db -- node -e "process.stdout.write(process.env.DB_URL)"` prints the expanded URL.
    - With `--no-expand` it prints the raw value.
    - `anchor folders list` shows `db`.
- [ ] **Step 2: Run them and fix what fails** (fix in the owning feature, with a test there first).
- [ ] **Step 3: Run the full verification.** Run `pnpm lint && pnpm typecheck && pnpm test`, then the Playwright suite and the CLI e2e suite. Expected: all pass. Paste the summary lines into the PR description.
- [ ] **Step 4: Update the docs** (README features, deploy runbook links, and the queue creation commands in the first-deploy steps).
- [ ] **Step 5: Commit** with `git commit -m "test: M5 end-to-end coverage and docs"`.

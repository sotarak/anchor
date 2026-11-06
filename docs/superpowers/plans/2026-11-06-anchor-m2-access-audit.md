# Anchor M2 — Access Control & Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multi-user Anchor. This milestone adds instance user management, invites, password change and reset links, project memberships with roles and environment restrictions, scoped service tokens for CI, and an append-only audit log with a query API and retention.

**Architecture:** M2 extends the M1 server in place.
- `Principal` becomes a union of user and service token. `authorize()` becomes async and checks memberships and token scopes in D1 on every request, with no cache, so revocation is immediate.
- Every token is 32 random bytes, stored as a SHA-256 hash, with a 12-character display prefix.
- Audit events are written with an awaited insert after each successful action. SQLite triggers make the table append-only inside the retention window, and a Cron Trigger purges older rows.

**Tech Stack:** Same as M1: Hono, D1, zod v4, Vitest with `@cloudflare/vitest-plugin`. Adds Cron Triggers. There are no new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-06-anchor-design.md`. Read §6.3–§6.5 and §13 (binding contracts) first. This plan builds on `docs/superpowers/plans/2026-11-06-anchor-m1-core-api.md`.

## Global Constraints

- Everything in the M1 plan's Global Constraints still applies.
- Token prefixes and lifetimes (spec §13.1):
  - Service token: `anc_st_`, 1–365 days, `expiresInDays` is mandatory.
  - Invite: `anc_inv_`, 72 h = `259_200_000` ms, single use.
  - Password reset: `anc_rst_`, 1 h = `3_600_000` ms, single use.
- Every token is 32 random bytes, base64url, stored only as SHA-256 hex. `token_prefix` is the first 12 characters of the token.
- Invite and reset links are `${origin}/accept-invite#token=<token>` and `${origin}/reset-password#token=<token>`, where `origin` is `new URL(c.req.url).origin`. The token is in the fragment, never in the query string.
- An invalid, expired, revoked or used invite or reset token always returns 404 `not_found` with message `"Link is invalid or has expired"`.
- Scope path matching: a scope with path `p` matches request path `q` when `p === "/"`, or `q === p`, or `q.startsWith(p + "/")`. Both paths are already normalized.
- Instance roles are `owner | admin | member`. Project roles are `admin | developer | viewer`. A project `admin` membership always has `environment_ids = NULL`.
- Audit:
  - Retention is 365 days = `31_536_000_000` ms.
  - Cron schedule is `"0 3 * * *"`.
  - Page `limit` defaults to 50, with a maximum of 200.
  - Writes are awaited, never `waitUntil`.
  - Metadata is JSON ≤ 16 KiB, and `secret.read` lists at most 500 keys, adding `keysTruncated: true` beyond that.
- `service_tokens.last_used_at` is written at most once per 60,000 ms per token.
- Audit metadata must never contain a key matching `/^(value|values|rawValue|password|currentPassword|newPassword|token|cookie|authorization)$/i`. `recordAudit` throws `Error("audit metadata contains forbidden field: <name>")` when it does. Secret values never appear anywhere in audit rows.
- Use only the names, routes and DTOs from spec §13 for public contracts. Internal helpers may be added.
- Test layout follows `docs/testing.md`:
  - Server tests live in `apps/server/test/<layer>/<mirror of src path>/<module>.test.ts`, where the layer is `unit` (pure logic), `integration` (service, repo or schema against D1) or `api` (HTTP through the Worker). Pick the lowest layer that can prove the behavior.
  - Tests import source through `#src/<path>` and shared helpers through `#test/support`. Helpers live in `apps/server/test/support/`, split by concern, and are re-exported from `support/index.ts`.
  - Every new table is added to `TABLES_CHILD_FIRST` in `apps/server/test/support/db.ts`. The guard test `test/integration/db/reset.test.ts` fails until it is.
  - Shared-package tests live in `packages/shared/test/schemas/<domain>.test.ts`, mirroring `src/schemas/<domain>.ts`.

## Review Focus

1. **Scope escape by a service token:** a token scoped to `prod:/api` requests `prod:/apix`, `prod:/`, `staging:/api`, or another project. Every one of these must be 403. A deleted and recreated environment with the same slug must not inherit old scopes, because scopes store environment ids. Tests are in Tasks 4 and 5.
2. **Revocation and disabling take effect on the very next request:** a revoked token, an expired token, a disabled user's sessions, sessions after a password reset, and other sessions after a password change. There is no caching anywhere. Tests are in Tasks 5, 7 and 9.
3. **An instance admin escalating to owner power:** promoting anyone (or themselves) to owner, editing, disabling or deleting an owner, creating a reset link for an owner or another admin, or inviting an owner must all be 403. The last active owner can never be demoted, disabled or deleted, even by themselves (409). Tests are in Tasks 7, 8 and 9.
4. **Single-use links under reuse and races:** accepting an invite twice, accepting two requests in parallel, using an expired or revoked invite, reusing a reset link, or using a reset link of a disabled user. Exactly one accept or reset may succeed, and every other attempt gets 404. Tests are in Tasks 8 and 9.
5. **Audit fails closed and never leaks values:** if the audit insert fails, a secret read returns 500 and no value is returned. Audit rows for secret create, update and read contain key names but never the value canary. UPDATE on audit rows, and DELETE of rows younger than 365 days, are rejected by the database. Tests are in Tasks 2, 3 and 10.

---

## File Structure

```
packages/shared/
  src/api.ts             + SessionDto, InviteDto, MemberDto, ServiceTokenDto, AuditEventDto, UserDto.disabledAt
  src/audit.ts           AUDIT_ACTIONS, AuditAction                      (new)
  src/index.ts           + export of ./audit
  src/schemas/auth.ts    + changePasswordBodySchema, resetPasswordBodySchema
  src/schemas/users.ts   instanceRoleSchema, updateUserBodySchema        (new)
  src/schemas/invites.ts createInviteBodySchema, inviteTokenBodySchema, acceptInviteBodySchema  (new)
  src/schemas/members.ts projectRoleSchema, addMemberBodySchema, updateMemberBodySchema         (new)
  src/schemas/service-tokens.ts  createServiceTokenBodySchema            (new)
  src/schemas/audit.ts   auditQuerySchema                                (new)
  src/schemas/index.ts   + re-exports of the new domain files
  test/audit.test.ts     (new)
  test/schemas/{auth,users,invites,members,service-tokens,audit}.test.ts  (new)
apps/server/
  migrations/0002_access.sql
  wrangler.jsonc         + triggers.crons
  src/index.ts           default export becomes { fetch, scheduled }
  src/env.ts             Principal union, Variables.requestId
  src/lib/random.ts      + newToken(), tokenPrefix()
  src/lib/request.ts     requestContext middleware (requestId, ip, userAgent)   (new)
  src/audit/record.ts    recordAudit(), actorOf()                                (new)
  src/audit/repo.ts      queryAudit(), purgeAudit()                              (new)
  src/audit/routes.ts    GET /audit, GET /projects/:p/audit                      (new)
  src/audit/scheduled.ts scheduled handler                                       (new)
  src/authz/policy.ts    async authorize(), visibleEnvironmentIds(), scopeMatches()
  src/auth/middleware.ts + service-token bearer, requirePrincipal(), requireUser() → 403 for tokens
  src/auth/sessions.ts   + listSessions(), revokeSessionById(), revokeUserSessions()
  src/auth/routes.ts     + password change, sessions, password-reset consume, /auth/me for tokens
  src/users/repo.ts      + listUsers, updateUser (last-owner guard), deleteUser, disabled filter
  src/users/routes.ts    GET/PATCH/DELETE /users, POST /users/:id/password-reset  (new)
  src/invites/repo.ts, src/invites/routes.ts                                     (new)
  src/members/repo.ts, src/members/routes.ts                                     (new)
  src/service-tokens/repo.ts, src/service-tokens/routes.ts                       (new)
  src/projects/routes.ts, src/secrets/routes.ts   awaited authorize + audit
  test/support/db.ts     + M2 tables in TABLES_CHILD_FIRST; resetDb drops and re-creates the audit retention trigger
  test/support/audit.ts  AUDIT_RETENTION_TRIGGER_DDL, auditRows(), failingAuditDb()   (new)
  test/support/factories/members.ts          createMember()              (new)
  test/support/factories/service-tokens.ts   createServiceToken()        (new)
  test/support/index.ts  + re-exports of audit, members and service-tokens
  test/unit/lib/random.test.ts                              (new)
  test/unit/authz/policy.test.ts                            scopeMatches; replaces the M1 table
  test/integration/db/migration-0002.test.ts                 (new)
  test/integration/audit/{record,scheduled}.test.ts         (new)
  test/integration/authz/policy.test.ts                     (new)
  test/api/{members,users,invites,service-tokens}/<feature>.test.ts   (new)
  test/api/auth/{passwords,session-management}.test.ts      (new)
  test/api/audit/{audit,wiring}.test.ts                     (new)
  test/api/{projects,secrets}/*.test.ts                     M1 tests updated for memberships
docs/deploy.md           + cron note, user management notes
```

---

### Task 0: Reconcile with merged M1 code

**Files:** none modified unless the plan needs fixing. Edit this plan file only.

- [ ] **Step 1: Check what M2 consumes.** For each name M2 takes from M1 (`createApp`, `AppEnv`, `Bindings`, `Principal`, `ApiError`, `parseJson`, `parseQuery`, `log`, `newId`, `newSessionToken`, `sha256Hex`, `toBase64Url`, `hashPassword`, `verifyPassword`, `verifyAgainstDummy`, `createSession`, `findPrincipalBySessionToken`, `reserveLoginAttempt`, `updateLoginState`, `revokeSession`, `setSessionCookie`, `authenticate`, `requireUser`, `checkOrigin`, `UserRow`, `findUserByEmail`, `findUserById`, `insertUser`, `toUserDto`, `authorize`, `Action`, `ProjectRow`, `EnvironmentRow`, `getProjectBySlug`, `getEnvironmentBySlug`, `listProjects`, `createProject`, the secrets service functions, and the test helpers `api`, `resetDb`, `createUserWithSession`, `jsonInit`, `TEST_ORIGIN`, which are exported from `apps/server/test/support/index.ts` as `#test/support`), run `grep -rn "<name>" apps/server/src apps/server/test packages/shared/src` and confirm its signature matches the M1 plan.
- [ ] **Step 2: Fix any mismatches in this plan.** Where the merged code differs, update the matching **Consumes** lines and test snippets here. Do not change merged code in this task.
- [ ] **Step 3: Run the baseline.** Run `pnpm lint && pnpm typecheck && pnpm test`. Expected: all green before starting M2.

---

### Task 1: Shared contracts for M2

**Files:**
- Create: `packages/shared/src/audit.ts`
- Create: `packages/shared/src/schemas/users.ts`, `packages/shared/src/schemas/invites.ts`, `packages/shared/src/schemas/members.ts`, `packages/shared/src/schemas/service-tokens.ts`, `packages/shared/src/schemas/audit.ts`
- Modify: `packages/shared/src/api.ts`, `packages/shared/src/schemas/auth.ts`, `packages/shared/src/schemas/index.ts` (re-export the new domain files), `packages/shared/src/index.ts` (export `./audit`)
- Test: `packages/shared/test/schemas/users.test.ts`, `packages/shared/test/schemas/auth.test.ts`, `packages/shared/test/schemas/invites.test.ts`, `packages/shared/test/schemas/members.test.ts`, `packages/shared/test/schemas/service-tokens.test.ts`, `packages/shared/test/schemas/audit.test.ts`, `packages/shared/test/audit.test.ts`

**Interfaces:**
- Produces (`audit.ts`): `AUDIT_ACTIONS` as a `const` tuple containing exactly the M2 list from spec §13.6, and `type AuditAction = (typeof AUDIT_ACTIONS)[number]`. M5 appends its actions later.
- Produces (`api.ts`): the DTOs exactly as in spec §13.5 (`SessionDto`, `InviteDto`, `MemberDto`, `ServiceTokenDto`, `AuditEventDto`), plus `UserDto.disabledAt?: number | null` and `type ProjectRole = "admin" | "developer" | "viewer"`. `AuditEventDto.actor.type` is `"user" | "service_token" | "anonymous"`. `AuditEventDto.metadata` is `Record<string, unknown>`.
- Produces (one file per domain under `packages/shared/src/schemas/`, each re-exported by `schemas/index.ts`):
  - `users.ts`:
    - `instanceRoleSchema`
    - `updateUserBodySchema { role?: instanceRole, disabled?: boolean }`, refined so at least one field is present
  - `auth.ts`:
    - `changePasswordBodySchema { currentPassword: string(1..1024), newPassword: passwordSchema }`
    - `resetPasswordBodySchema { token, password: passwordSchema }`
  - `invites.ts`:
    - `createInviteBodySchema { email, role: instanceRole }`
    - `inviteTokenBodySchema { token: string(1..200) }`
    - `acceptInviteBodySchema { token, name: string(1..100), password: passwordSchema }`
  - `members.ts`:
    - `projectRoleSchema`
    - `addMemberBodySchema { email, role: projectRole, environments: slug[] (1..50, unique) | null = null }`, refined so `role === "admin"` requires `environments === null`
    - `updateMemberBodySchema { role?, environments? }`, with the same refinement when both are present
  - `service-tokens.ts`:
    - `createServiceTokenBodySchema { name: string(1..64), permission: "read" | "read-write", scopes: { environment: slug, path: secretPathSchema }[] (1..20), expiresInDays: int(1..365) }`
  - `audit.ts`:
    - `auditQuerySchema { projectId?: string, actorId?: string, action?: AuditAction, before?: string(1..200), limit: coerce int(1..200) = 50 }`

- [ ] **Step 1: Write the failing tests.** Each test file imports from `../../src/schemas/<domain>` (the shared package has no `#src` alias).
  - `test/schemas/members.test.ts`:
    - `addMember rejects admin with environments`: `{ email: "a@x.io", role: "admin", environments: ["prod"] }` fails, and `environments: null` passes.
    - `addMember rejects duplicate env slugs`
  - `test/schemas/service-tokens.test.ts`:
    - `serviceToken requires expiresInDays 1..365`: 0, 366 and missing all fail, 1 and 365 pass.
    - `serviceToken normalizes scope paths`: `"api/"` becomes `"/api"`, and `"/../x"` fails.
    - `serviceToken requires at least one scope`
  - `test/schemas/users.test.ts`:
    - `updateUser requires a field`: `{}` fails.
  - `test/schemas/audit.test.ts`:
    - `auditQuery coerces limit and caps at 200`: `"10"` becomes 10, and `"201"` fails.
  - `test/audit.test.ts` (mirrors `src/audit.ts`, imports from `../src/audit`):
    - `AUDIT_ACTIONS contains every M2 action in spec §13.6`: compare against a literal array copied from the spec.
  - `test/schemas/auth.test.ts` and `test/schemas/invites.test.ts` hold the plain accept and reject cases for `changePasswordBodySchema`, `resetPasswordBodySchema` and the invite schemas.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm --filter @anchor/shared test`. Expected: FAIL.
- [ ] **Step 3: Implement the shared contracts.**
- [ ] **Step 4: Run the tests and confirm they pass.** Run `pnpm --filter @anchor/shared test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(shared): M2 DTOs, schemas and audit actions"`.

---

### Task 2: Migration 0002, append-only audit table and token helpers

**Files:**
- Create: `apps/server/migrations/0002_access.sql`
- Create: `apps/server/test/support/audit.ts` (exports the trigger DDL constant now, and gains more helpers in Task 3)
- Modify: `apps/server/src/lib/random.ts`, `apps/server/test/support/db.ts` (add the new tables to `TABLES_CHILD_FIRST`; `resetDb` must delete `audit_events` with a statement the trigger allows, see Step 3), `apps/server/test/support/index.ts` (re-export `./audit`)
- Test: `apps/server/test/integration/db/migration-0002.test.ts`, `apps/server/test/unit/lib/random.test.ts`

**Interfaces:**
- Produces: the tables from spec §13.3 (M2), with these exact details:

```sql
ALTER TABLE users ADD COLUMN disabled_at INTEGER;
CREATE TABLE invites (
  id TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
  token_hash TEXT NOT NULL UNIQUE, token_prefix TEXT NOT NULL,
  created_by TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  accepted_at INTEGER, revoked_at INTEGER
);
CREATE TABLE password_resets (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, token_prefix TEXT NOT NULL,
  created_by TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
);
CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin','developer','viewer')),
  environment_ids TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX project_members_user ON project_members(user_id);
CREATE TABLE service_tokens (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token_prefix TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (permission IN ('read','read-write')),
  scopes TEXT NOT NULL, created_by TEXT, created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, last_used_at INTEGER, revoked_at INTEGER
);
CREATE TABLE audit_events (            -- no foreign keys: rows must survive deletes of what they describe
  id TEXT PRIMARY KEY, at INTEGER NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user','service_token','anonymous')),
  actor_id TEXT, actor_label TEXT, action TEXT NOT NULL,
  project_id TEXT, environment_id TEXT, target TEXT,
  ip TEXT, user_agent TEXT, request_id TEXT, metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_events_at ON audit_events(at DESC, id);
CREATE INDEX audit_events_project ON audit_events(project_id, at DESC);
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER audit_events_retention BEFORE DELETE ON audit_events
WHEN old.at > (CAST(strftime('%s','now') AS INTEGER) * 1000 - 31536000000)
BEGIN SELECT RAISE(ABORT, 'audit_events within retention cannot be deleted'); END;
```

- Produces (`random.ts`): `type TokenKind = "anc_s" | "anc_st" | "anc_inv" | "anc_rst"`, `newToken(kind: TokenKind): string` (`${kind}_${base64url(32 random bytes)}`), and `tokenPrefix(token: string): string` (`token.slice(0, 12)`). `newSessionToken()` becomes `newToken("anc_s")`.

- [ ] **Step 1: Write the failing tests.**
  - `audit_events rejects UPDATE`: insert a row with `at = Date.now()`, then expect `UPDATE audit_events SET action='x'` to reject with a message containing `append-only`.
  - `audit_events rejects DELETE of a young row`: the message contains `retention`.
  - `audit_events allows DELETE of a row older than 365 days`: `at = Date.now() - 31_536_000_000 - 60_000`.
  - `deleting a project keeps its audit rows`: audit row with `project_id = p.id`, delete the project, and the row still exists.
  - `deleting a project cascades members and service tokens`
  - `newToken has prefix and 43 base64url chars`: regex `/^anc_st_[A-Za-z0-9_-]{43}$/`.
  - `tokenPrefix is 12 chars`
- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm --filter ./apps/server exec vitest run test/integration/db test/unit/lib/random.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write the migration and the helpers.** Add `invites`, `password_resets`, `project_members`, `service_tokens` and `audit_events` to `TABLES_CHILD_FIRST` in `test/support/db.ts`, children before parents. The guard test `test/integration/db/reset.test.ts` fails until every new table is listed. Because of the retention trigger, `resetDb()` cannot delete young audit rows. Make it run `DROP TRIGGER audit_events_retention`, then `DELETE FROM audit_events`, then re-create the trigger with the exact DDL above (read it from one exported constant, `AUDIT_RETENTION_TRIGGER_DDL` in `test/support/audit.ts`, so it cannot drift). Run `wrangler d1 migrations apply anchor --local` to confirm that D1 accepts triggers. If D1 rejects `RAISE` inside triggers, stop and report: spec §6.5 depends on it.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `pnpm --filter ./apps/server exec vitest run test/integration/db test/unit/lib/random.test.ts`. Expected: PASS, including `reset.test.ts`.
- [ ] **Step 5: Commit** with `git commit -m "feat(server): access-control tables and append-only audit log"`.

---

### Task 3: Request context and audit recorder

**Files:**
- Create: `apps/server/src/lib/request.ts`, `apps/server/src/audit/record.ts`
- Modify: `apps/server/src/env.ts` (`Variables.requestId: string`, `Variables.clientIp: string | null`, `Variables.userAgent: string | null`), `apps/server/src/app.ts` (register `requestContext` before `authenticate` on `/api/*`), `apps/server/test/support/audit.ts` (add `auditRows`, `failingAuditDb`)
- Test: `apps/server/test/integration/audit/record.test.ts`

**Interfaces:**
- Produces (`request.ts`): `requestContext` middleware. It sets:
  - `requestId`: the `cf-ray` header, or `newId()` when the header is absent
  - `clientIp`: the `cf-connecting-ip` header, or null
  - `userAgent`: the `user-agent` header truncated to 512 chars, or null

  It also sets the response header `x-request-id`.
- Produces (`record.ts`):
  - `type AuditActor = { type: "user" | "service_token" | "anonymous"; id: string | null; label: string | null }`
  - `actorOf(principal: Principal | undefined): AuditActor` maps as follows:
    - user → `{ "user", userId, email }`
    - service token → `{ "service_token", tokenId, name }`
    - undefined → `{ "anonymous", null, null }`
  - `type AuditInput = { action: AuditAction; actor?: AuditActor; projectId?: string | null; environmentId?: string | null; target?: string | null; metadata?: Record<string, unknown> }`
  - `recordAudit(c: Context<AppEnv>, input: AuditInput): Promise<void>` inserts one row and awaits it. The actor defaults to `actorOf(c.var.principal)`. It validates metadata against the forbidden-key regex at every depth, throwing on a match. It serializes the metadata, and if the result is over 16,384 bytes it throws `Error("audit metadata too large")`.
  - `capKeys(keys: string[]): { keys: string[]; keysTruncated?: true }` keeps 500 keys at most.
- Produces (`test/support/audit.ts`, imported through `#test/support`): `auditRows(action?: AuditAction): Promise<AuditRow[]>`, and `failingAuditDb(db: D1Database): D1Database`. The latter is a Proxy whose `prepare(sql)` throws `Error("audit unavailable")` when `sql` contains `INSERT INTO audit_events`, and passes every other statement through. Use it with `createApp().request(path, init, { ...env, DB: failingAuditDb(env.DB) })`.

- [ ] **Step 1: Write the failing tests.** Mount a test-only route on `createApp()` that calls `recordAudit`.
  - `records actor, request id, ip and user agent`: send headers `cf-ray: ray-1`, `cf-connecting-ip: 203.0.113.9` and `user-agent: t/1`. The row has those values, and the response has `x-request-id: ray-1`.
  - `anonymous actor when no principal`
  - `rejects forbidden metadata keys at any depth`: `{ value: "x" }`, `{ nested: { password: "x" } }` and `{ Token: "x" }` all throw, and no row is written.
  - `allows key names in metadata`: `{ path: "/", keys: ["DB_URL"] }` is stored as JSON.
  - `capKeys truncates at 500`: 501 keys give length 500 and `keysTruncated: true`.
  - `oversized metadata throws`
- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm --filter ./apps/server exec vitest run test/integration/audit/record.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(audit): request context and awaited audit recorder"`.

---

### Task 4: Principal union and async authorization policy

**Files:**
- Modify: `apps/server/src/env.ts`, `apps/server/src/authz/policy.ts`, `apps/server/src/auth/middleware.ts`, and every M1 route that calls `authorize` or `requireUser` (`projects/routes.ts`, `secrets/routes.ts`, `auth/routes.ts`)
- Create: `apps/server/src/members/repo.ts` (read side only in this task)
- Create: `apps/server/test/support/factories/members.ts` (`createMember`)
- Modify: `apps/server/test/support/index.ts` (re-export `./factories/members`)
- Test:
  - `apps/server/test/unit/authz/policy.test.ts` (`scopeMatches`; replaces the M1 table)
  - `apps/server/test/integration/authz/policy.test.ts` (`authorize` and `visibleEnvironmentIds` against D1 memberships)
  - `apps/server/test/api/projects/projects.test.ts` and `apps/server/test/api/projects/environments.test.ts` (membership-filtered listings)

**Interfaces:**
- Produces (`env.ts`): `Principal` exactly as in spec §13.2, plus internal fields `name: string` and `expiresAt: number` on the service-token variant:
  - `{ type: "user"; userId; email; name; role; sessionId }`
  - `{ type: "service_token"; tokenId; projectId; name; permission; scopes; expiresAt }`
- Produces (`members/repo.ts`): `type MembershipRow = { project_id; user_id; role: ProjectRole; environment_ids: string[] | null }` (parsed from JSON), `getMembership(db, projectId, userId): Promise<MembershipRow | null>`.
- Produces (`policy.ts`):
  - `type Action = <M1 actions> | "member:manage" | "service_token:manage" | "audit:read" | "user:manage" | "invite:manage"`
  - `type Resource = { projectId: string; environmentId?: string; path?: string }`
  - `scopeMatches(scopePath: string, path: string): boolean`
  - `authorize(db: D1Database, principal: Principal, action: Action, resource?: Resource): Promise<void>` throws `ApiError(403, "forbidden", "You do not have permission to perform this action")`. It throws a plain `Error("resource required for <action>")` (a programming error) when `secret:*` lacks `environmentId` or `path`, or when a project-level action lacks `projectId`. The rules:
    - **User with instance role owner or admin:** everything is allowed.
    - **User with instance role member:**
      - `project:create`, `project:delete`, `user:manage`, `invite:manage`, and `audit:read` without a projectId → deny.
      - Otherwise a membership on `resource.projectId` is required.
      - `project:read` → any membership role.
      - `secret:read` → any role, and the environment is allowed.
      - `secret:write` → role developer or admin, and the environment is allowed.
      - `environment:manage`, `project:update`, `member:manage`, `service_token:manage`, and `audit:read` with a projectId → role admin.
      - "The environment is allowed" means `environment_ids === null` or it includes `resource.environmentId`.
    - **Service token:**
      - `resource.projectId` must equal `principal.projectId`.
      - `project:read` → allowed.
      - `secret:read` → some scope has `environmentId === resource.environmentId` and `scopeMatches(scope.path, resource.path)`.
      - `secret:write` → the same check, plus `permission === "read-write"`.
      - Every other action → deny.
  - `visibleEnvironmentIds(db, principal, projectId): Promise<Set<string> | "all">` returns:
    - owner/admin → `"all"`
    - member → `"all"` when `environment_ids` is null, else that set; no membership → empty set
    - token → the set of its scope environment ids
- Produces (`middleware.ts`): `requirePrincipal(c): Principal` throws 401. `requireUser(c): Extract<Principal, { type: "user" }>` throws 401 when unauthenticated and 403 `forbidden` "This endpoint requires a user session" for tokens. M1 project, environment and secret routes switch to `requirePrincipal` and `await authorize(c.env.DB, ...)`, passing `environmentId` and `path` for secret routes. `GET /projects` lists only projects where `authorize(..., "project:read", { projectId })` passes. Implement this with one SQL query via `listProjectsForPrincipal(db, principal)` in `projects/repo.ts`, not by looping over `authorize`. `GET /projects/:p/environments` filters by `visibleEnvironmentIds`.

- [ ] **Step 1: Write the failing tests.** Add `createMember(projectSlug, opts: { role: ProjectRole; environments?: string[] | null; instanceRole?: InstanceRole })` in `test/support/factories/members.ts`, re-exported from `#test/support`. It inserts a user, a session and a membership row directly, and returns `{ userId, token }`. Tests:
  - `test/integration/authz/policy.test.ts` (the `authorize` rules against D1):
    - `owner and admin are allowed every action` (table over all `Action` values)
    - `member without membership is denied project:read`
    - `viewer can read but not write secrets`
    - `developer can write in allowed env and is denied in a restricted env`: environments `["dev"]`, so a write to `prod` → 403.
    - `member cannot manage environments, members or tokens unless project admin`
    - `member is denied project:create, project:delete, user:manage, invite:manage and instance audit`
    - `service token denied outside its project, env, path, and denied write when read-only`, built from a hand-made token `Principal`
    - `service token denied every non-secret action except project:read`
    - `authorize throws a programming error when secret action lacks environmentId`
  - `test/unit/authz/policy.test.ts` (pure):
    - `scopeMatches`: `("/", "/x")` → true, `("/api", "/api")` → true, `("/api", "/api/db")` → true, `("/api", "/apix")` → false, `("/api", "/")` → false, `("/api/db", "/api")` → false (Review Focus 1)
  - API tests: `member sees only their projects in GET /projects` (in `test/api/projects/projects.test.ts`), and `member with env restriction sees only allowed environments` (in `test/api/projects/environments.test.ts`).
  - Update the M1 tests that expected "member → 403 everywhere" (`test/api/projects/*.test.ts`, `test/api/secrets/secrets.test.ts`, and the M1 table in `test/unit/authz/policy.test.ts`): they must now give a member without membership a 403, and a member with membership the role-appropriate result.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm --filter ./apps/server exec vitest run test/unit/authz test/integration/authz test/api/projects`. Expected: FAIL.
- [ ] **Step 3: Implement the policy, the repo and the middleware changes, and update the M1 routes.**
- [ ] **Step 4: Run the full suite.** Run `pnpm --filter ./apps/server test` (all layers). Expected: PASS, including all M1 tests.
- [ ] **Step 5: Commit** with `git commit -m "feat(authz): principal union, memberships and async authorization"`.

---

### Task 5: Service tokens

**Files:**
- Create: `apps/server/src/service-tokens/repo.ts`, `apps/server/src/service-tokens/routes.ts`
- Modify: `apps/server/src/auth/middleware.ts` (bearer dispatch), `apps/server/src/auth/routes.ts` (`/auth/me`), `apps/server/src/app.ts`
- Create: `apps/server/test/support/factories/service-tokens.ts` (`createServiceToken`)
- Modify: `apps/server/test/support/index.ts` (re-export `./factories/service-tokens`)
- Test: `apps/server/test/api/service-tokens/service-tokens.test.ts`

**Interfaces:**
- Consumes: `newToken`, `tokenPrefix`, `sha256Hex`, `authorize`, `recordAudit`, `getEnvironmentBySlug`, `listEnvironments`.
- Produces (repo):
  - `createServiceToken(db, input: { projectId; name; permission; scopes: { environmentId: string; path: string }[]; expiresAt: number; createdBy: string }, now): Promise<{ row: ServiceTokenRow; token: string }>`
  - `findPrincipalByServiceToken(db, token: string, now: number): Promise<Principal | null>` returns null when the token is unknown, revoked (`revoked_at` not null) or expired (`expires_at <= now`). It updates `last_used_at` only when that value is null or older than `now - 60_000`.
  - `listServiceTokens(db, projectId)`, `revokeServiceToken(db, projectId, id, now): Promise<boolean>`
  - `toServiceTokenDto(row, projectSlug, envSlugById: Map<string, string>): ServiceTokenDto` drops scopes whose environment no longer exists.
- Produces (middleware): a Bearer value starting with `anc_st_` resolves through `findPrincipalByServiceToken`, and one starting with `anc_s_` resolves through sessions. Anything else is unauthenticated.
- Produces (routes under `/api/v1/projects/:project/service-tokens`, `service_token:manage`, user principals only via `requireUser`):
  - `GET /` → `{ serviceTokens: ServiceTokenDto[] }`, newest first, including revoked tokens.
  - `POST /` → 201 `{ serviceToken, token }`. Environment slugs resolve to ids; an unknown slug → 404 "Environment not found". Audit `service_token.created` with metadata `{ name, permission, scopes }`, where scopes use env slugs.
  - `DELETE /:id` → 204, idempotent. Unknown id or an id from another project → 404. Audit `service_token.revoked`.
- Produces: `GET /auth/me` for a token → `{ serviceToken: ServiceTokenDto }`.

- [ ] **Step 1: Write the failing tests.** Add the helper `createServiceToken(projectSlug, { permission, scopes: [{ environment, path }], expiresInDays? })` in `test/support/factories/service-tokens.ts`, re-exported from `#test/support`, which goes through the API as owner and returns the token string. Tests:
  - `create returns the token once; list never includes it` (no `token` field in the list, and no string starting with `anc_st_` in the list body)
  - `stored row holds only the hash`
  - `token reads secrets in scope over HTTP`
  - `token is 403 on prod:/apix, prod:/ and staging:/api when scoped to prod:/api` (Review Focus 1)
  - `token is 403 on another project` and `404-vs-403`: another project's slug → 403, never data
  - `read-only token gets 403 on PUT`
  - `revoked token is 401 on the very next request` (Review Focus 2)
  - `expired token is 401`: set `expires_at` to `Date.now() - 1`
  - `recreated environment with the same slug does not inherit scope`: delete `prod`, recreate `prod`, then the token → 403 (Review Focus 1)
  - `token cannot call user-only endpoints`: `POST /auth/password` and `GET /users` → 403
  - `token cannot create tokens or manage members` → 403
  - `/auth/me returns serviceToken DTO`
  - `last_used_at is throttled`: two requests within 60 s cause a single update; compare the column before and after with a manual `last_used_at` set to `now - 30_000`
  - `developer member cannot create tokens; project admin can`
  - `expiresInDays 366 -> 400`
- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm --filter ./apps/server exec vitest run test/api/service-tokens`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(tokens): scoped, expiring, revocable service tokens"`.

---

### Task 6: Project memberships

**Files:**
- Modify: `apps/server/src/members/repo.ts`
- Create: `apps/server/src/members/routes.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/test/api/members/members.test.ts`

**Interfaces:**
- Produces (repo): `listMembers(db, projectId): Promise<MemberDto[]>` (joins users, maps env ids to slugs, drops deleted envs), `addMember(db, { projectId, userId, role, environmentIds: string[] | null }, now)` (duplicate → 409 "User is already a member"), `updateMember(db, projectId, userId, patch: { role?: ProjectRole; environmentIds?: string[] | null }, now)`, `removeMember(db, projectId, userId): Promise<boolean>`.
- Produces (routes under `/api/v1/projects/:project/members`, `member:manage`):
  - `GET /` → `{ members }`
  - `POST /` → 201 `{ member }`:
    - An unknown email → 404 "User not found".
    - A disabled user → 409 "User is disabled".
    - Environment slugs resolve to ids, and an unknown slug → 404.
  - `PATCH /:userId` → `{ member }`. When the result would be `role = admin` with non-null environments → 400.
  - `DELETE /:userId` → 204, or 404 when the user is not a member.
  - Audit `member.added`, `member.updated` and `member.removed` with metadata `{ userId, role, environments }`.

- [ ] **Step 1: Write the failing tests:**
  - `project admin adds a developer restricted to dev; developer can write dev, gets 403 on prod`
  - `viewer can list and read with reveal but cannot PUT`
  - `removing a member revokes access on the next request` (Review Focus 2)
  - `adding the same user twice -> 409`, `unknown email -> 404`, `unknown env slug -> 404`
  - `admin role with environments -> 400` on both POST and PATCH
  - `developer cannot manage members -> 403`
  - `deleting an environment drops it from member DTOs and access`
  - `audit rows for add/update/remove exist with actor = project admin`
- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm --filter ./apps/server exec vitest run test/api/members`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(members): project memberships with environment restrictions"`.

---

### Task 7: Instance user management and disabled users

**Files:**
- Modify: `apps/server/src/users/repo.ts`, `apps/server/src/auth/sessions.ts`, `apps/server/src/auth/routes.ts` (login checks `disabled_at`)
- Create: `apps/server/src/users/routes.ts`
- Test: `apps/server/test/api/users/users.test.ts`

**Interfaces:**
- Produces (repo):
  - `listUsers(db): Promise<UserRow[]>`, where `UserRow` gains `disabled_at: number | null`, and `toUserDto` includes `disabledAt`.
  - `updateUserGuarded(db, targetId, patch: { role?: InstanceRole; disabledAt?: number | null }, now): Promise<"ok" | "last_owner">` runs one conditional `UPDATE` and returns `"last_owner"` when it would leave zero active owners. The SQL guard is `... AND (role != 'owner' OR <patch keeps them an active owner> OR (SELECT count(*) FROM users WHERE role = 'owner' AND disabled_at IS NULL AND id != ?) > 0)`.
  - `deleteUserGuarded(db, targetId): Promise<"ok" | "last_owner" | "not_found">`
- Produces (sessions): `revokeUserSessions(db, userId, exceptSessionId?: string): Promise<void>`. `findPrincipalBySessionToken` returns null for users with `disabled_at` set (a JOIN condition).
- Produces (routes, all user-only via `requireUser`):
  - `GET /api/v1/users` (`user:manage`) → `{ users: UserDto[] }`
  - `PATCH /api/v1/users/:id` (`user:manage`) → `{ user }`. Check these rules in order:
    1. Target not found → 404.
    2. Target is self and `disabled: true` → 409 "You cannot disable yourself".
    3. The actor is admin, and either the target is an owner or `role === "owner"` → 403.
    4. The guard result is `last_owner` → 409 "An instance must keep at least one active owner".
    5. Disabling also calls `revokeUserSessions`.
    6. Audit `user.updated` with `{ userId, role?, disabled? }`.
  - `DELETE /api/v1/users/:id` (`user:manage`) → 204, with the same self, owner and last-owner rules, and audit `user.deleted` with `{ userId, email }`.
- Login: a disabled user with the correct password → 403 `forbidden` "Account disabled". A wrong password still gets 401.

- [ ] **Step 1: Write the failing tests:**
  - `admin lists users; member gets 403`
  - `admin promotes member to admin; admin cannot promote anyone to owner -> 403` (Review Focus 3)
  - `admin cannot demote, disable or delete an owner -> 403` (Review Focus 3)
  - `owner can promote admin to owner`
  - `last active owner cannot demote, disable or delete themselves -> 409`. With two owners, demoting one succeeds; afterwards demoting the remaining one → 409.
  - `disabled second owner does not count as active owner`: owner A, disabled owner B → demoting A → 409.
  - `disabling a user revokes their sessions immediately` (both cookie and bearer → 401) (Review Focus 2)
  - `disabled user login with correct password -> 403, wrong password -> 401`
  - `re-enabling restores login`
  - `cannot disable or delete yourself -> 409`
  - `deleting a user removes memberships and sessions`
  - `audit row for user.updated has no password fields`
- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm --filter ./apps/server exec vitest run test/api/users`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(users): instance user management with last-owner guard"`.

---

### Task 8: Invites

**Files:**
- Create: `apps/server/src/invites/repo.ts`, `apps/server/src/invites/routes.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/test/api/invites/invites.test.ts`

**Interfaces:**
- Produces (repo):
  - `createInvite(db, { email, role, createdBy }, now): Promise<{ row: InviteRow; token: string }>`. The invite expires at `now + 259_200_000`.
  - `listInvites(db)`, `revokeInvite(db, id, now): Promise<boolean>`
  - `findValidInvite(db, token, now): Promise<InviteRow | null>` (not accepted, not revoked, not expired)
  - `acceptInvite(db, token, { name, passwordHash }, now): Promise<string | null>` returns the new user id, or null. It runs one `db.batch`:
    1. `INSERT INTO users (...) SELECT ... FROM invites WHERE token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ? AND NOT EXISTS (SELECT 1 FROM users WHERE email = invites.email)`
    2. `UPDATE invites SET accepted_at = ? WHERE token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?`

    It returns null unless both statements changed exactly one row. Generate the user id before the batch.
  - `toInviteDto`
- Produces (routes):
  - `GET /api/v1/invites` (`invite:manage`) → `{ invites }`.
  - `POST /api/v1/invites` (`invite:manage`) → 201 `{ invite, url }`:
    - Admin inviting `owner` → 403.
    - An email that already belongs to a user → 409 "User already exists".
    - An existing pending, unexpired invite → 409 "A pending invite exists; revoke it first".
    - Audit `invite.created` with `{ email, role }`.
  - `DELETE /api/v1/invites/:id` (`invite:manage`) → 204, with audit `invite.revoked`.
  - `POST /api/v1/invites/inspect` (public) → `{ email, role }`, or 404 "Link is invalid or has expired".
  - `POST /api/v1/invites/accept` (public) → 200 `LoginResponse` with the web session cookie set, or 404 with the same message. It audits `invite.accepted` with the actor set to the new user `{ "user", id, email }`.

- [ ] **Step 1: Write the failing tests:**
  - `create returns url with token in fragment`: matches `/^http:\/\/anchor\.test\/accept-invite#token=anc_inv_[A-Za-z0-9_-]{43}$/`, and the invite list holds no token.
  - `inspect returns email and role`
  - `accept creates the user with the invited role and logs them in`
  - `accepting twice -> second is 404` (Review Focus 4)
  - `two parallel accepts -> exactly one 200, one 404, one user row` (`Promise.all`) (Review Focus 4)
  - `expired invite -> 404 on inspect and accept`: set `expires_at` to the past
  - `revoked invite -> 404`
  - `admin cannot invite an owner -> 403`, `owner can` (Review Focus 3)
  - `invite for an existing user's email -> 409`, `duplicate pending invite -> 409`
  - `weak password on accept -> 400, invite still usable`
  - `member cannot create invites -> 403`
  - `404 bodies for invalid, expired and used tokens are byte-identical`
- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm --filter ./apps/server exec vitest run test/api/invites`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(invites): single-use invite links"`.

---

### Task 9: Password change, reset links and session management

**Files:**
- Create: `apps/server/src/users/password-resets.ts`
- Modify: `apps/server/src/auth/routes.ts`, `apps/server/src/users/routes.ts`, `apps/server/src/auth/sessions.ts`
- Test: `apps/server/test/api/auth/passwords.test.ts`, `apps/server/test/api/auth/session-management.test.ts` (session list and revoke; the M1 `test/api/auth/sessions.test.ts` stays as is)

**Interfaces:**
- Produces (`password-resets.ts`):
  - `createPasswordReset(db, userId, createdBy, now): Promise<{ token: string; expiresAt: number }>`. It first marks every unused reset of that user as used (`used_at = now`), so only the newest link works. It expires at `now + 3_600_000`.
  - `consumePasswordReset(db, token, passwordHash, now): Promise<string | null>` returns the user id, or null. It runs one batch:
    1. `UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = (SELECT user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?) AND disabled_at IS NULL`
    2. `UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? AND user_id IN (SELECT id FROM users WHERE disabled_at IS NULL)`

    It succeeds only when both statements changed one row. On success the caller runs `revokeUserSessions(db, userId)`.
- Produces (sessions): `listSessions(db, userId, currentSessionId): Promise<SessionDto[]>` (`id = session.id.slice(0, 16)`, newest first, unexpired only), `revokeSessionByShortId(db, userId, shortId: string): Promise<boolean>` (`shortId` must match `/^[0-9a-f]{16}$/`, else 400; matching is restricted to `user_id`).
- Produces (routes):
  - `POST /api/v1/auth/password` (user) → 204:
    - A wrong current password → 401 `invalid_credentials`, which counts toward lockout. Reserve the attempt atomically with `reserveLoginAttempt(db, userId, now, { maxFailures: MAX_FAILED_LOGINS, lockoutMs: LOCKOUT_MS })` before verifying (429 when it returns false), and reset with `updateLoginState(db, userId, { failedLogins: 0, lockedUntil: null })` on success, exactly as M1 login does after its final-review fix.
    - On success it re-hashes, calls `revokeUserSessions(db, userId, currentSessionId)`, and audits `auth.password_changed`.
  - `POST /api/v1/users/:id/password-reset` (`user:manage`) → 201 `{ url, expiresAt }`, with audit `password_reset.created` and `{ userId }`. These rules apply:
    - Target is self → 409 "Use change password instead".
    - Actor is admin and the target is an owner or admin → 403.
    - Target is disabled → 409 "User is disabled".
  - `POST /api/v1/auth/password-reset` (public) → 204, or 404 "Link is invalid or has expired". It audits `auth.password_reset` with the actor set to the reset user.
  - `GET /api/v1/auth/sessions` (user) → `{ sessions }`
  - `DELETE /api/v1/auth/sessions/:id` (user) → 204, or 404. It audits `session.revoked`.

- [ ] **Step 1: Write the failing tests.**
  - `change password with the correct current password revokes other sessions but keeps this one` (Review Focus 2)
  - `change password with the wrong current password -> 401 and counts toward lockout`
  - `new password policy enforced -> 400`
  - `reset link: owner creates for member; member resets; old password fails; all old sessions 401` (Review Focus 2)
  - `reset link reused -> 404` and `two parallel resets -> exactly one 204` (Review Focus 4)
  - `expired reset link -> 404`
  - `creating a new reset invalidates the previous link`
  - `reset for a disabled user -> 409 on create; a link created before disabling -> 404 on use` (Review Focus 4)
  - `admin cannot create a reset for an owner or another admin -> 403` (Review Focus 3)
  - `reset clears lockout`: lock the user (5 failures), reset, and login works
  - `url has token in fragment` (regex for `/reset-password#token=anc_rst_...`)
  - `sessions list marks current; ids are 16 hex chars, not the stored hash`
  - `revoking another own session by short id -> that token 401`
  - `cannot revoke another user's session -> 404`, `malformed id -> 400`
  - `service token on /auth/password and /auth/sessions -> 403`
- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm --filter ./apps/server exec vitest run test/api/auth`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(auth): password change, reset links and session management"`.

---

### Task 10: Audit the M1 routes

**Files:**
- Modify: `apps/server/src/auth/routes.ts` (setup, login, logout), `apps/server/src/projects/routes.ts`, `apps/server/src/secrets/routes.ts`
- Test: `apps/server/test/api/audit/wiring.test.ts` (uses `auditRows` and `failingAuditDb` from `#test/support`)

**Interfaces:**
- Consumes: `recordAudit`, `capKeys`, `actorOf`.
- Produces these audit events. Each one is recorded after the action succeeds and before the response is returned.
  - Auth:
    - `auth.setup`: actor is the new owner.
    - `auth.login`: actor is the user; metadata `{ client }`.
    - `auth.login_failed`: actor `{ "anonymous", null, <submitted email, lowercased> }`; metadata `{ reason: "invalid_credentials" | "locked" | "disabled" }`.
    - `auth.logout`: only when a session was presented.
  - Projects and environments:
    - `project.created`, `project.updated`, `project.deleted`: `projectId` set; metadata `{ slug, name }`.
    - `environment.created`, `environment.updated`, `environment.deleted`: `projectId` and `environmentId` set; metadata `{ slug, name }`.
  - Secrets:
    - `secret.read` is emitted only when values are returned: `GET /secrets?reveal=true` and `GET /secrets/:key`. Metadata is `{ path, ...capKeys(keys) }`, and `target` is the key for a single get. A list without reveal is not audited.
    - `secret.created` and `secret.updated` are emitted only when `changed`; metadata `{ path, key, version }`.
    - `secret.deleted`: metadata `{ path, key }`.
- For a secret read, run `recordAudit` before the response body is built. If it throws, the request fails with 500 and no value goes out.

- [ ] **Step 1: Write the failing tests.**
  - `login success and failure are audited; failure label is the submitted email`
  - `locked login is audited with reason locked`
  - `project and environment lifecycle events are recorded with ids`
  - `secret write is audited once; identical put is not audited`
  - `secret.read audited for reveal list and single get, not for plain list`
  - `service-token reads are audited with actor service_token and its name`
  - `audit rows never contain the value canary`: put `"AUDIT-CANARY-51e2"` and update it to `"AUDIT-CANARY-2"`; read, list with reveal, then delete. `SELECT * FROM audit_events` serialized contains neither canary (Review Focus 5).
  - `secret read fails closed when audit insert fails`: `GET /secrets/:key` via `failingAuditDb` → 500 `internal`, and the body does not contain the value (Review Focus 5).
  - `500 from audit failure logs unhandled_error without the value` (console spy)
- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm --filter ./apps/server exec vitest run test/api/audit/wiring.test.ts`. Expected: FAIL.
- [ ] **Step 3: Wire `recordAudit` into the routes.**
- [ ] **Step 4: Run the full suite.** Run `pnpm --filter ./apps/server test` (all layers). Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(audit): record auth, project, environment and secret events"`.

---

### Task 11: Audit query API, retention purge and docs

**Files:**
- Create: `apps/server/src/audit/repo.ts`, `apps/server/src/audit/routes.ts`, `apps/server/src/audit/scheduled.ts`
- Modify: `apps/server/src/index.ts`, `apps/server/src/app.ts`, `apps/server/wrangler.jsonc` (`"triggers": { "crons": ["0 3 * * *"] }`), `docs/deploy.md`
- Test: `apps/server/test/api/audit/audit.test.ts` (query API), `apps/server/test/integration/audit/scheduled.test.ts` (retention purge, mirrors `src/audit/scheduled.ts`)

**Interfaces:**
- Produces (repo):
  - `encodeCursor(at: number, id: string): string` (base64url of `${at}:${id}`) and `decodeCursor(s: string): { at: number; id: string }`, which throws `ApiError(400, "bad_request", "invalid cursor")`.
  - `queryAudit(db, filter: { projectId?; actorId?; action?; before?: string; limit: number }): Promise<{ events: AuditEventDto[]; nextCursor: string | null }>`. It orders by `at DESC, id DESC`, applies the cursor as `(at < ? OR (at = ? AND id < ?))`, and fetches `limit + 1` rows to decide whether `nextCursor` exists.
  - `purgeAudit(db, now): Promise<number>`, which runs `DELETE FROM audit_events WHERE at < now - 31_536_000_000` and returns the number of deleted rows.
- Produces (routes):
  - `GET /api/v1/audit` (`audit:read`, no projectId) uses `auditQuerySchema`.
  - `GET /api/v1/projects/:project/audit` (`audit:read` with `{ projectId }`) ignores any `projectId` query parameter and forces its own.
- Produces (`scheduled.ts`): `handleScheduled(controller: ScheduledController, env: Bindings, ctx: ExecutionContext): Promise<void>` calls `purgeAudit` and logs `audit_purged` with `{ count }`. `src/index.ts` exports `default { fetch: app.fetch, scheduled: handleScheduled } satisfies ExportedHandler<Bindings>`.

- [ ] **Step 1: Write the failing tests.**
  - `pagination walks all events without duplicates or gaps`: insert 120 events, 5 of which share the same `at`. Paging with `limit=50` gives 50 + 50 + 20, the union equals the inserted ids, and the last page has `nextCursor: null`.
  - `filters by action, actorId and projectId`
  - `tampered cursor -> 400`, `limit=500 -> 400`
  - `instance audit: admin 200, member 403, service token 403`
  - `project audit: project admin sees only that project; developer 403; projectId query param cannot widen scope`
  - `metadata is returned parsed as an object`
  - `scheduled purge deletes only rows older than 365 days`: rows at `now - 366d` and `now - 364d`, run `handleScheduled` with `createScheduledController()` from `cloudflare:test`, and only the old row is gone (Review Focus 5)
- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm --filter ./apps/server exec vitest run test/api/audit/audit.test.ts test/integration/audit/scheduled.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement, and update `docs/deploy.md`.** The docs must say:
  - The Cron Trigger is deployed automatically.
  - Audit rows are kept for 365 days.
  - The first owner manages users at `/api/v1/users` (UI in M4).
  - Lost-owner recovery: run `wrangler d1 execute anchor --remote --command "UPDATE users SET disabled_at = NULL, role = 'owner' WHERE email = '...'"`. This is a break-glass step, and the docs must note that the operator should audit it manually.
- [ ] **Step 4: Run the full verification.** Run `pnpm lint && pnpm typecheck && pnpm test` (all layers and packages). Expected: all pass. Then run `wrangler d1 migrations apply anchor --local`. Expected: 0002 applies on top of 0001.
- [ ] **Step 5: Smoke-test locally.** Run `wrangler dev --test-scheduled`, then `curl "http://localhost:8787/__scheduled?cron=0+3+*+*+*"`. Expected: an `audit_purged` log line.
- [ ] **Step 6: Commit** with `git commit -m "feat(audit): query API with cursor pagination and retention purge"`.

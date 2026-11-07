# Anchor — Product & Architecture Spec

Status: approved decisions from scoping session on 2026-11-06. This document is the source of truth
for stack and security decisions (see `CLAUDE.md`: "No stack decisions are final until recorded in
`docs/`"). Each milestone gets its own implementation plan in `docs/superpowers/plans/`.

## 1. Goal

A self-hostable secrets and configuration manager in the spirit of Infisical that runs entirely on
Cloudflare's developer platform. One team deploys one Anchor instance to their own Cloudflare account
and manages secrets through a web dashboard and a CLI (for developers and CI).

## 2. Decisions

| Area | Decision | Notes |
|------|----------|-------|
| Deployment | **Self-hosted, single organization per deployment** | No multi-tenancy, signup, quotas or billing. The instance *is* the organization. |
| Encryption model | **Server-side envelope encryption** | Server can decrypt. Enables references, imports, future integrations and rotation. E2EE is out of scope. |
| Dashboard auth | **Email + password** | PBKDF2-SHA256 via WebCrypto. Server-side sessions. |
| Email delivery | **None in MVP** | Invites and password resets are one-time links an admin copies and hands over. First owner is created through a setup screen guarded by a deploy-time setup token. |
| API | **Hono on Workers**, JSON over HTTPS under `/api/v1` | |
| Data store | **D1** as the single source of truth | Strongly consistent; one org's write volume fits a single D1 database. Durable Objects/KV not used in MVP. Queues/Cron only where noted (M2 audit retention, M5 key rotation). |
| Dashboard | **React SPA** (Vite, React, TanStack Router + Query, Tailwind, shadcn/ui) | Built to static files, served by **Workers Static Assets from the same Worker** (`not_found_handling: "single-page-application"`, `run_worker_first: ["/api/*"]`). |
| CLI | **TypeScript**, same monorepo, shares schemas with the API | Distributed as single-file binaries via `bun build --compile` (macOS/Linux/Windows) plus an npm package. Bun is needed only to build binaries. |
| Repo | **pnpm workspaces** monorepo | `packages/shared`, `apps/server`, `apps/web`, `apps/cli`. |
| Validation | **zod v4** schemas in `@anchor/shared`, used by server, web and CLI | |
| Tests | **Vitest**; server tests run inside workerd via `@cloudflare/vitest-plugin` | TDD per `test-driven-development`. |
| Lint/format | **Biome** | |
| Platform plan | **Workers Paid** is required | PBKDF2 at 100k iterations exceeds the Free plan's CPU limit per login. |

## 3. Non-goals (MVP)

End-to-end encryption, multi-tenant SaaS, SSO/SAML/OIDC, sending email, third-party integrations
(GitHub/Vercel/... sync), dynamic secrets, secret sharing links, approval workflows, Kubernetes
operator, SDKs other than the CLI.

## 4. Architecture

```
            ┌─────────────── Cloudflare account (self-hosted) ───────────────┐
 Browser ──►│ Worker "anchor"                                                │
            │   /api/*  → Hono app ── authn ── authz ── services ──► D1      │
 CLI/CI  ──►│   other   → Static Assets (React SPA, index.html fallback)     │
            │   secrets: ANCHOR_ROOT_KEY, ANCHOR_SETUP_TOKEN                 │
            └────────────────────────────────────────────────────────────────┘
```

- One Worker, one D1 database (`DB` binding), one assets binding (`ASSETS`, from M4).
- Server code is organized by feature (`auth/`, `projects/`, `secrets/`, ...) with thin route
  modules, plain repository functions over D1, and pure services that are tested directly.
- Every `/api` response carries `Cache-Control: no-store`.

## 5. Domain model

- **User** — instance-level account: email (unique, case-insensitive), name, password hash, instance
  role `owner | admin | member`. Owners/admins manage users and see all projects.
- **Project** — `slug` (immutable, URL/CLI identifier) and `name`. Has its own key-encryption key (KEK).
- **Environment** — belongs to a project; `slug`, `name`, `position`. New projects get `dev`,
  `staging`, `prod`. A project always keeps at least one environment.
- **Folder path** — secrets live at a path inside an environment: `/`, `/api`, `/api/db`. Path
  segments match `[A-Za-z0-9_-]+`, max depth 10, max length 256. M1 stores the path on each secret;
  M5 adds explicit folders (so empty folders exist) and folder listing.
- **Secret** — `(environment, path, key)` unique; `key` matches `^[A-Za-z_][A-Za-z0-9_]{0,254}$`
  (env-var safe, case-sensitive). Value ≤ 64 KiB UTF-8. Optional comment ≤ 500 chars.
- **Secret version** — append-only; every value/comment change creates version `n+1`. Deleting a
  secret deletes its versions (M1). Rollback creates a new version copying an old one (M5).
- **Project membership** (M2) — user × project with role `admin | developer | viewer` and an optional
  list of allowed environments (null = all).
- **Service token** (M2) — machine identity scoped to one project, a set of `(environment, path
  prefix)` scopes, permission `read | read-write`, mandatory expiry (max 365 days), revocable,
  `last_used_at` tracked.
- **Invite / password reset token** (M2) — one-time, hashed at rest, expires after 72 h / 1 h.
- **Audit event** (M2) — append-only record of security-relevant actions.
- **Secret reference / folder import** (M5) — see §9.

## 6. Security design

### 6.1 Threat model

In scope: leaked user session or service token, malicious or over-curious member, compromised CI
runner, D1 dump or backup leak, attacker with D1 write access swapping rows, brute-force login,
someone claiming a freshly deployed instance before its owner.

Out of scope: full Cloudflare account takeover (attacker gets both D1 and the root key), compromised
user endpoint while unlocked, side channels inside workerd.

### 6.2 Key hierarchy

```
ANCHOR_ROOT_KEY (Worker secret, 32 random bytes base64, id "rk1")
  └─ wraps (AES-256-GCM, AAD "anchor/kek/v1|<projectId>|<kekVersion>")
       Project KEK (32 random bytes, versioned, stored wrapped in project_keys)
         └─ encrypts (AES-256-GCM, AAD "anchor/secret/v1|<projectId>|<environmentId>|<secretId>|<version>")
              secret value
```

- Two tiers (root → project KEK → value) instead of a per-value DEK: rotating a KEK means
  re-encrypting values either way, so a third tier adds no benefit for MVP. Recorded deliberately.
- Every encryption uses a fresh 96-bit IV from `crypto.getRandomValues`. Stored per value: `alg`
  (`A256GCM`), `key_version`, `iv`, `ciphertext` (includes tag).
- AAD binds ciphertext to its row, so moving ciphertext between rows, environments or projects fails
  decryption. A decryption failure is an integrity incident: 500 `internal` to the client, a
  `secret_decrypt_failed` log event with ids only.
- The root key is imported once per isolate as a non-extractable `CryptoKey`. A missing or malformed
  root key fails closed (500 `internal`, `config_error` log).
- **Root key loss = data loss.** Deploy docs instruct operators to back it up offline. D1 Time Travel
  covers database restore, not keys.
- KEK rotation and root key rotation are M5 (background re-encryption via Queues, idempotent).

### 6.3 Passwords and sessions

- PBKDF2-SHA256, **100,000 iterations** (workerd's maximum, below OWASP's 600k; mitigated by
  lockout), 16-byte salt, 32-byte output, stored as `pbkdf2-sha256$<iter>$<salt b64>$<hash b64>` so
  parameters can evolve. Passwords are 12–1024 characters.
- Login lockout: 5 consecutive failures lock the account for 15 minutes (429 `rate_limited`, even
  with the correct password). Unknown emails run a dummy verification and return the same 401
  `invalid_credentials` as a wrong password.
- Sessions: 32 random bytes, presented as `anc_s_<base64url>`, stored as SHA-256 hex. Web sessions
  live 7 days in cookie `__Host-anchor_session` (`HttpOnly; Secure; SameSite=Strict; Path=/`). CLI
  sessions live 30 days and are sent as `Authorization: Bearer anc_s_...`. Logout deletes the row
  (immediate revocation, no caching).
- CSRF: cookie-authenticated unsafe methods (`POST/PUT/PATCH/DELETE`) require an `Origin` header equal
  to the request origin. Bearer requests skip this (no ambient credential).
- Setup: `POST /api/v1/setup` works only while there are zero users, and only with a `setupToken`
  equal to the `ANCHOR_SETUP_TOKEN` Worker secret (compared with `timingSafeEqual` over SHA-256
  digests). If the secret is unset, setup is disabled (503 `setup_disabled`).
  **Superseded in 0.3.0:** setup needs no token; see `2026-11-07-v0.3.0-design.md`, "First-owner
  setup without a token".

### 6.4 Authorization

Every route calls `authorize(principal, action, resource)`; there are no internal routes that skip it.
M1: owners/admins are allowed everything, members are denied (no memberships yet). M2 adds project
memberships, per-environment restrictions and service-token scopes behind the same function.

| Action | viewer | developer | project admin | instance owner/admin |
|--------|--------|-----------|---------------|----------------------|
| `secret:read` (allowed envs) | ✓ | ✓ | ✓ | ✓ |
| `secret:write` (allowed envs) | | ✓ | ✓ | ✓ |
| `environment:manage`, `project:update`, members, tokens | | | ✓ | ✓ |
| `project:create`, `project:delete`, users, invites | | | | ✓ |

### 6.5 Logging and audit

- One logger (`lib/log.ts`) emits JSON lines and redacts any field whose name matches
  `/(value|password|token|secret|key|cookie|authorization)/i`. Request bodies are never logged.
  Validation errors report the field path and issue code, never the input.
- Audit (M2): `audit_events` (id, at, actor type/id, action, project, environment, target, ip,
  user agent, request id, metadata JSON without values). An SQLite trigger blocks `UPDATE` and blocks
  `DELETE` of rows younger than the retention window (365 days); a Cron Trigger purges older rows.
  Audited: login success/failure, logout, setup, user/invite/membership changes, project/environment
  changes, secret read (names only)/create/update/delete, token issue/revoke.

## 7. API conventions

- Base path `/api/v1`. JSON request/response bodies. Resources addressed by slugs:
  `/projects/:project/environments/:env/secrets/:key?path=/api`.
- Errors: `{ "error": { "code": ErrorCode, "message": string } }`, with codes `bad_request`,
  `unauthenticated`, `invalid_credentials`, `forbidden`, `not_found`, `conflict`, `rate_limited`,
  `setup_disabled`, `payload_too_large`, `internal`.
- Secret listing omits values unless `reveal=true`. Reading values is an audited action (M2).
- Writes are idempotent where cheap: `PUT` of an identical value and comment is a no-op `200`.
- Concurrent writes to the same secret: the loser gets 409 `conflict` and no partial state.

## 8. CLI (M3)

Binary `anchor`. Conventions follow the `building-cli` skill (stdout = data, `--json` on every
command, secrets never in argv, `--yes` required for destructive operations in non-TTY).

| Command | Purpose |
|---------|---------|
| `anchor login [--api-url]` | Email + hidden password prompt → CLI session token (30 days) |
| `anchor logout` | Revoke the session server-side, delete the local credential |
| `anchor whoami` | Show the current user or token identity |
| `anchor init` | Link the directory to a project and default env: writes `.anchor.json` (ids only) |
| `anchor projects list`, `anchor envs list` | Discovery |
| `anchor secrets list/get/set/delete` | `set` reads the value from stdin, `--from-file` or a hidden prompt |
| `anchor run [--env] [--path] -- <cmd>` | Inject secrets into the child env; forward signals; exit with the child's code; fail closed |
| `anchor export --format dotenv\|json\|yaml [--output file]` | File written with mode 0600; warns if the file is not gitignored |

Auth sources by precedence: `ANCHOR_TOKEN` env var (service token, CI) > stored CLI session. Stored
credentials go to the OS keychain where available, else `~/.config/anchor/credentials.json` with mode 0600 and a
warning. Config precedence: flags > `ANCHOR_*` env > `.anchor.json` > user config > defaults.
Browser device-flow login is a later improvement, not MVP.

Pinned during M3 planning:
- `anchor login --password-stdin` reads the password from stdin for non-TTY use. The password is never in argv.
- `ANCHOR_TOKEN` is only sent to an API URL from a flag, `ANCHOR_API_URL` or user config. A URL that
  comes only from the committed `.anchor.json` is refused. This stops a PR from redirecting the CI token
  to an attacker's host.
- `.anchor.json` with unknown keys or any `anc_`-prefixed value is rejected.
- `export --format dotenv` fails with a hint (use json/yaml) for values that cannot round-trip through a
  dotenv parser, instead of writing corrupted output.

## 9. Advanced secrets (M5)

- **References:** `${KEY}` (same env and path) and `${<env>:<path>/<KEY>}` such as
  `${prod:/db/PASSWORD}`. Expanded server-side on read when `expand=true` (the CLI default for `run`
  and `export`). Max depth 5, cycles → 400. Each referenced secret is authorized for the caller.
- **Folder imports:** a folder can import another `(env, path)`; local keys win over imported keys.
- **History:** list versions (metadata), reveal a past version, roll back (creates a new version).
- **Escaping and failure:** `$${` yields a literal `${`; text that does not match the grammar stays
  literal; a grammar-valid reference to a missing secret is a 400 (never an empty string);
  authorization is checked before existence (403 reveals nothing). Imports are not transitive.
- **Key rotation:** new KEK version for new writes, background re-encryption, root key rotation with
  `ANCHOR_ROOT_KEY_ID` (default `rk1`), `ANCHOR_ROOT_KEY_PREVIOUS` and `ANCHOR_ROOT_KEY_PREVIOUS_ID`
  accepted for decryption until `POST /admin/root-key/rewrap` has re-wrapped every KEK.

## 10. Dashboard (M4)

Setup screen, login, projects list, project overview (keys × environments matrix with
missing-value markers, like Infisical), environment view with a folder path breadcrumb (folder tree
in M5) and secret table (masked values, reveal per row, add/edit in a side Sheet, delete with
confirmation), project settings
(environments, members, service tokens), instance users and invites, audit log viewer with filters,
account page (change password, sessions).

Visual language and layout follow the project skill `.claude/skills/dashboard-ui` (Novu-style:
`tokens.css`, `AppShell` with a 275px sidebar and a global environment switcher card, title in the header,
dashed filter chips, right-side `Sheet` for create/edit, masked values with hover reveal/copy).

## 11. Milestones

Each milestone is shippable and testable on its own and gets its own plan.

| # | Milestone | Deliverable / exit criteria |
|---|-----------|-----------------------------|
| M1 | **Core API foundation** | Monorepo, CI, D1 schema, envelope crypto, setup + password login + sessions, projects, environments, secrets CRUD with versions and paths. All via HTTP API, tested in workerd. Deploy guide. |
| M2 | **Access control & audit** | Instance users, invites, password reset links, project memberships with roles + env restrictions, service tokens, audit log + retention. |
| M3 | **CLI** | Commands in §8, keychain storage, binaries via Bun, end-to-end tests against a local Worker. |
| M4 | **Dashboard** | SPA in §10 served by the Worker's static assets. |
| M5 | **Advanced secrets** | Folders, history/rollback, references, imports, KEK and root key rotation. |

## 12. Risks

- **PBKDF2 cap** (100k) is below current OWASP guidance; lockout compensates. Revisit if Workers
  adds Argon2 or raises the cap. The hash format is versioned for re-hashing on login.
- **CPU per login** requires Workers Paid.
- **Root key loss** is unrecoverable by design.
- **D1 size/throughput** limits are ample for one organization; re-evaluate before any multi-tenant
  plans.

## 13. Cross-milestone contracts (M2–M5)

Plans for M2–M5 are written up front, against the M1 plan's interfaces. Each later plan starts with a
reconciliation step: compare the names and signatures it consumes with the merged code and fix the
plan before Task 1. The contracts below are binding across plans. A plan may add internals, but
it must not rename anything listed here.

### 13.1 Token formats (all: 32 random bytes, base64url, stored as SHA-256 hex only)

| Token | Prefix | Lifetime | Delivered |
|-------|--------|----------|-----------|
| Session | `anc_s_` | web 7 d / cli 30 d | cookie / JSON once |
| Service token | `anc_st_` | 1–365 d (mandatory) | JSON once at creation |
| Invite | `anc_inv_` | 72 h, single use | link `/<origin>/accept-invite#token=...` |
| Password reset | `anc_rst_` | 1 h, single use | link `/<origin>/reset-password#token=...` |

Tokens go in the URL **fragment** so they never reach server logs. Every token store keeps a
`token_prefix` (first 12 characters) for display. An invalid, expired or used invite or reset token
returns 404 `not_found`, so the response does not reveal which of these it was.

### 13.2 Principal (M2)

```ts
type Principal =
  | { type: "user"; userId; email; name; role: InstanceRole; sessionId }
  | { type: "service_token"; tokenId; projectId; permission: "read" | "read-write";
      scopes: { environmentId: string; path: string }[] };
```

In M2, `authorize` becomes `authorize(db, principal, action, resource?: { projectId: string;
environmentId?: string; path?: string }): Promise<void>` and every caller awaits it.

A scope path is a prefix: `/` matches all paths, and `/api` matches `/api` and `/api/...` but not `/apix`.

Disabled users (`users.disabled_at` set) cannot authenticate. Disabling a user revokes their sessions.

### 13.3 Tables added

- **M2 (`0002_access.sql`):**
  - `users.disabled_at INTEGER`
  - `invites(id, email, role, token_hash UNIQUE, token_prefix, created_by, created_at, expires_at, accepted_at, revoked_at)`
  - `password_resets(id, user_id, token_hash UNIQUE, token_prefix, created_by, created_at, expires_at, used_at)`
  - `project_members(project_id, user_id, role CHECK IN ('admin','developer','viewer'), environment_ids TEXT NULL /* JSON array of env ids */, created_at, updated_at, PK(project_id, user_id))`
  - `service_tokens(id, project_id, name, token_hash UNIQUE, token_prefix, permission, scopes TEXT /* JSON [{environmentId,path}] */, created_by, created_at, expires_at, last_used_at, revoked_at)`
  - `audit_events(id, at, actor_type, actor_id, actor_label, action, project_id, environment_id, target, ip, user_agent, request_id, metadata TEXT)` with index `(at DESC, id)` and `(project_id, at DESC)`, plus triggers that block UPDATE and block DELETE of rows younger than 365 days.
- **M5 (`0003_folders_imports.sql`):**
  - `folders(id, environment_id, path, created_at, UNIQUE(environment_id, path))`
  - `folder_imports(id, environment_id, path, source_environment_id, source_path, position, created_at, UNIQUE(environment_id, path, source_environment_id, source_path))`
  - `project_keys.status TEXT NOT NULL DEFAULT 'active' CHECK IN ('active','retiring','retired')`
  - `key_rotations(id, project_id, from_version, to_version, status, total, done, started_at, finished_at)`

### 13.4 Endpoints added (all under `/api/v1`)

| Milestone | Method & path | Who | Result |
|-----------|---------------|-----|--------|
| M2 | `GET /auth/me` | any principal | `{ user }` for users, `{ serviceToken: ServiceTokenDto }` for tokens |
| M2 | `POST /auth/password` `{currentPassword,newPassword}` | user | 204; revokes the user's other sessions |
| M2 | `GET /auth/sessions`, `DELETE /auth/sessions/:id` | user | own sessions (`SessionDto[]`) |
| M2 | `GET /users`, `PATCH /users/:id` `{role?,disabled?}`, `DELETE /users/:id` | instance owner/admin; only owners change owners; the last owner cannot be demoted, disabled or deleted (409) | `UserDto` (+`disabledAt`) |
| M2 | `POST /users/:id/password-reset` | instance owner/admin | `{ url, expiresAt }` |
| M2 | `POST /auth/password-reset` `{token,password}` | public | 204; revokes all sessions of that user |
| M2 | `GET /invites`, `POST /invites` `{email,role}`, `DELETE /invites/:id` | instance owner/admin | `InviteDto` (+ `url` once on create) |
| M2 | `POST /invites/inspect` `{token}` | public | `{ email, role }` |
| M2 | `POST /invites/accept` `{token,name,password}` | public | `LoginResponse` (web cookie) |
| M2 | `GET/POST /projects/:p/members`, `PATCH/DELETE /projects/:p/members/:userId` | project admin | `MemberDto` (`POST` body `{email, role, environments: string[] \| null}` — env slugs) |
| M2 | `GET/POST /projects/:p/service-tokens`, `DELETE /projects/:p/service-tokens/:id` | project admin | `ServiceTokenDto` (+ `token` once on create). Body `{name, permission, scopes:[{environment, path}], expiresInDays}` |
| M2 | `GET /audit?projectId&actorId&action&before&limit` | instance owner/admin | `{ events: AuditEventDto[], nextCursor }` |
| M2 | `GET /projects/:p/audit?...` | project admin | same, filtered to the project |
| M4 | `GET /projects/:p/overview?path=` | `secret:read` | `{ environments: EnvironmentDto[], keys: { key, cells: Record<envSlug, { version, updatedAt } \| null> }[] }` (no values; only envs the caller may read) |
| M5 | `GET/POST/DELETE /projects/:p/environments/:e/folders?path=` | read / write | `{ folders: FolderDto[] }` (direct children); delete of a non-empty folder → 409 unless `force=true` |
| M5 | `GET /…/secrets/:key/versions?path=` | `secret:read` | `{ versions: SecretVersionDto[] }` (no values) |
| M5 | `GET /…/secrets/:key/versions/:version?path=` | `secret:read` | `{ version: SecretVersionDto & { value } }` |
| M5 | `POST /…/secrets/:key/rollback` `{path, version}` | `secret:write` | `{ secret }` (new version copying the old) |
| M5 | `GET /…/secrets?expand=true&includeImports=true` and `GET /…/secrets/:key?expand=true` | `secret:read` | `value` expanded; `rawValue` added when it differs; imported entries carry `importedFrom: {environment, path}` |
| M5 | `GET/POST/DELETE /projects/:p/environments/:e/imports?path=` | read / write | `{ imports: FolderImportDto[] }` |
| M5 | `POST /projects/:p/keys/rotate`, `GET /projects/:p/keys` | project admin | 202 `{ rotation: KeyRotationDto }` / `{ keys, rotations }` |
| M5 | `POST /admin/root-key/rewrap` | instance owner | `{ rewrapped: number }` |

### 13.5 DTOs added to `@anchor/shared`

`UserDto.disabledAt?: number | null`; `SessionDto { id, kind, userAgent, createdAt, lastUsedAt,
expiresAt, current: boolean }` (`id` is the session id hash's first 16 hex chars, not the hash);
`InviteDto { id, email, role, tokenPrefix, createdAt, expiresAt, acceptedAt, revokedAt }`;
`MemberDto { userId, email, name, role, environments: string[] | null }`;
`ServiceTokenDto { id, name, tokenPrefix, projectSlug, permission, scopes: { environment: string; path: string }[], createdAt, expiresAt, lastUsedAt, revokedAt }`;
`AuditEventDto { id, at, actor: { type, id, label }, action, projectId, environmentId, target, ip, userAgent, requestId, metadata }`;
`FolderDto { path, name }`; `SecretVersionDto { version, comment, createdAt, createdBy: { id, label } | null }`;
`FolderImportDto { id, path, source: { environment, path }, position }`;
`KeyRotationDto { id, fromVersion, toVersion, status, total, done, startedAt, finishedAt }`.
M4 adds `ProjectAccessDto { role: "admin" | "developer" | "viewer"; environments: string[] | null }`
(instance owners/admins get `{ role: "admin", environments: null }`), exposed as the additive
`ProjectDto.access?` on `GET /projects` and `GET /projects/:p` for user principals, and
`OverviewDto` for the overview endpoint in §13.4.

### 13.6 Audit actions (string literals, `AUDIT_ACTIONS` in shared)

`auth.setup`, `auth.login`, `auth.login_failed`, `auth.logout`, `auth.password_changed`,
`auth.password_reset`, `session.revoked`, `user.updated`, `user.deleted`, `invite.created`,
`invite.revoked`, `invite.accepted`, `password_reset.created`, `project.created`, `project.updated`,
`project.deleted`, `environment.created`, `environment.updated`, `environment.deleted`,
`member.added`, `member.updated`, `member.removed`, `service_token.created`,
`service_token.revoked`, `secret.read`, `secret.created`, `secret.updated`, `secret.deleted`;
M5 adds `secret.rolled_back`, `secret.version_read`, `folder.created`, `folder.deleted`,
`import.created`, `import.deleted`, `kek.rotation_started`, `kek.rotation_finished`,
`root_key.rewrapped`. `secret.read` is one event per request with `metadata { path, keys: string[] }`.
Audit writes are awaited (not `waitUntil`). Metadata never contains values.

### 13.7 CLI and web stack details

- **CLI (`apps/cli`, M3):**
  - `commander` for parsing, `@inquirer/prompts` for prompts. Uses only Node built-ins that Bun also supports.
  - Tests use Vitest on Node, and e2e tests run against a local Worker started with Wrangler's programmatic API.
  - Credentials:
    - macOS: the `security` keychain, fed via `security -i` on stdin so the token never appears in argv.
    - Linux: `secret-tool` (token on stdin) when present.
    - Otherwise: a file with mode 0600 plus a warning.
  - Exit codes: 0 ok, 1 error, 2 usage, 3 auth required, 4 forbidden, 5 not found, 6 conflict.
  - Release: GitHub Actions builds `bun build --compile` binaries for darwin-arm64/x64, linux-arm64/x64 and windows-x64. The npm package name is `@anchor-secrets/cli`, a placeholder the owner confirms before the first publish.
- **Web (`apps/web`, M4):**
  - Vite + React 19 + TanStack Router (file-based) + TanStack Query + Tailwind v4 + shadcn/ui, with forms validated by the shared zod schemas.
  - The visual design follows the project skill `.claude/skills/dashboard-ui` (Novu-style; `tokens.css`, `components.md`): Inter + JetBrains Mono via `@fontsource`, `react-icons/ri`, `sonner` toasts, an `AppShell` with a 275px sidebar and a global environment switcher, Sheets for create/edit, and Dialogs for confirm/one-time reveal.
  - Tests: Vitest with Testing Library and MSW for components, plus a Playwright smoke suite against `wrangler dev`.
  - Static assets: `apps/web/dist` is served by the Worker (`assets.directory: "../web/dist"`), with a `_headers` file setting CSP `default-src 'self'`, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`.
- **Background work (M2/M5):**
  - Cron Trigger `0 3 * * *` purges audit events older than 365 days.
  - The Queue `anchor-reencrypt` (consumer in the same Worker) re-encrypts in batches of 100 versions. It is idempotent: it skips versions already at the target key version.

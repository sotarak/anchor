# Anchor M1 — Core API Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployable Anchor Worker whose HTTP API supports first-owner setup, password login with sessions, projects, environments, and encrypted secrets with versions and folder paths.

**Architecture:** A pnpm monorepo with `@anchor/shared` (zod schemas, error codes, DTO types) and `apps/server` (Hono on Workers, D1). Envelope encryption: a Worker-secret root key wraps a per-project KEK, and the KEK encrypts secret values with AES-256-GCM and row-binding AAD. Server code is grouped by feature, with thin routes, repository functions over D1, and services tested inside workerd.

**Tech Stack:** TypeScript 5, pnpm workspaces, Hono ^4.13, zod ^4, Wrangler ^4.158, D1, Vitest ^5.1 (fall back to ^4.1 if `@cloudflare/vitest-plugin` rejects it), `@cloudflare/vitest-plugin` ^1.6, Biome.

**Spec:** `docs/superpowers/specs/2026-11-06-anchor-design.md`. Read sections 5–7 before starting.

## Global Constraints

- Node ≥ 22, pnpm ≥ 10. All packages are ESM (`"type": "module"`), TypeScript `strict: true`.
- Code, comments, commit messages and docs are in English.
- Never commit `.dev.vars`, real keys or tokens. Test keys are generated at test start in `vitest.config.ts`.
- Never log secret values, passwords, tokens or keys. Use `lib/log.ts` only. Never use `console.*` directly in `apps/server/src`.
- Only use `crypto.getRandomValues` / `crypto.randomUUID` for randomness. Compare secrets with `crypto.subtle.timingSafeEqual` on equal-length buffers.
- Timestamps are integer milliseconds since epoch (`Date.now()`). IDs are `crypto.randomUUID()`.
- Every `/api` response has `Cache-Control: no-store`. Every error body has the shape `{ error: { code, message } }` (spec §7).
- Slugs match `^[a-z0-9][a-z0-9-]{0,62}$`. Secret keys match `^[A-Za-z_][A-Za-z0-9_]{0,254}$`. Values are ≤ 65,536 UTF-8 bytes. Comments are ≤ 500 chars. Passwords are 12–1024 chars.
- AAD strings are exactly `anchor/kek/v1|<projectId>|<kekVersion>` and `anchor/secret/v1|<projectId>|<environmentId>|<secretId>|<version>`.
- PBKDF2-SHA256 uses 100,000 iterations, a 16-byte salt and 32-byte output. Stored format: `pbkdf2-sha256$100000$<salt b64>$<hash b64>`.
- Sessions use the token format `anc_s_<base64url of 32 bytes>`, stored as SHA-256 hex. The cookie is `__Host-anchor_session` (`HttpOnly; Secure; SameSite=Strict; Path=/`). TTL is 7 days for web and 30 days for CLI.
- Lockout: 5 consecutive failures → locked for 15 minutes.
- Security-sensitive tasks (5–10, 13) must include tests for the failure cases listed, not only the happy paths.

## Review Focus

1. **Fresh instance claimed by a stranger:** if `POST /setup` runs before the operator reaches it, it must need `ANCHOR_SETUP_TOKEN`. When that secret is unset, setup is disabled (503 `setup_disabled`). It must never be open. Tests are in Task 9.
2. **Two writers update the same secret at once** (CLI and dashboard): one wins and the other gets 409 `conflict`, with no orphan version row and an unchanged `current_version`. Tests are in Task 13.
3. **The operator sets a wrong, malformed or missing `ANCHOR_ROOT_KEY`:** secret reads fail closed with 500 `internal` and a `config_error` / `secret_decrypt_failed` log. They never return garbage, and the response never contains key material. Tests are in Tasks 6 and 13.
4. **Awkward values:** an empty string, a multiline PEM, emoji/Unicode, and a value of exactly 65,536 bytes all round-trip byte-exact, and 65,537 bytes is rejected with 413 `payload_too_large`. Tests are in Task 13.
5. **Path spellings:** `api`, `/api` and `/api/` all mean the same folder. `//`, `.`, `..` and over-deep paths are rejected with 400. Keys stay case-sensitive (`DB_URL` ≠ `db_url`). Tests are in Tasks 2 and 13.

---

## File Structure

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, biome.json, .github/workflows/ci.yml
packages/shared/
  package.json                 exports ./src/index.ts (no build step)
  src/index.ts                 re-exports
  src/schemas.ts               zod schemas + normalizeSecretPath + utf8ByteLength
  src/errors.ts                ERROR_CODES, ErrorCode, ApiErrorBody
  src/api.ts                   DTO types
  test/schemas.test.ts
apps/server/
  package.json, wrangler.jsonc, tsconfig.json, vitest.config.ts, .dev.vars.example
  migrations/0001_init.sql
  src/index.ts                 export default createApp()
  src/app.ts                   createApp(): mounts routes, middleware, onError, notFound
  src/env.ts                   AppEnv, Bindings, Principal
  src/lib/errors.ts            ApiError, ConfigError, IntegrityError, errorHandler, notFoundHandler
  src/lib/validate.ts          parseJson, parseQuery
  src/lib/log.ts               log() with redaction
  src/lib/encoding.ts          base64 / base64url / hex / utf8 helpers
  src/lib/random.ts            randomBytes, newId, newSessionToken, sha256Hex
  src/crypto/aead.ts           AES-256-GCM encrypt/decrypt with AAD
  src/crypto/keyring.ts        root key import, KEK wrap/unwrap, AAD builders
  src/crypto/password.ts       PBKDF2 hash/verify
  src/auth/sessions.ts         create/find/revoke sessions
  src/auth/middleware.ts       authenticate, requireUser, checkOrigin
  src/auth/lockout.ts          pure lockout state machine
  src/auth/routes.ts           setup, login, logout, me
  src/users/repo.ts            user queries
  src/authz/policy.ts          authorize()
  src/projects/repo.ts         project + KEK + default env provisioning
  src/projects/routes.ts       projects + environments routes
  src/secrets/repo.ts          secret + version queries
  src/secrets/service.ts       encrypt/decrypt, versioning, idempotent put
  src/secrets/routes.ts
  test/apply-migrations.ts     vitest setup file
  test/helpers.ts              api(), resetDb(), createUserWithSession(), jsonInit()
  test/*.test.ts
docs/deploy.md
```

---

### Task 1: Monorepo scaffold and health endpoint

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `.github/workflows/ci.yml`
- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/wrangler.jsonc`, `apps/server/vitest.config.ts`, `apps/server/src/index.ts`, `apps/server/src/app.ts`, `apps/server/src/env.ts`, `apps/server/test/apply-migrations.ts`, `apps/server/test/helpers.ts`, `apps/server/migrations/.gitkeep`
- Test: `apps/server/test/health.test.ts`

**Interfaces:**
- Produces: `createApp(): Hono<AppEnv>` in `src/app.ts`, and `AppEnv = { Bindings: Bindings; Variables: { principal?: Principal } }` in `src/env.ts`. `Bindings` is `{ DB: D1Database; ANCHOR_ROOT_KEY: string; ANCHOR_SETUP_TOKEN?: string }`. `Principal` is declared here as `{ type: "user"; userId: string; email: string; name: string; role: "owner" | "admin" | "member"; sessionId: string }`.
- Produces: `test/helpers.ts` with `api(path: string, init?: RequestInit): Promise<Response>`, which calls `exports.default.fetch(new Request("http://anchor.test" + path, init))` with `exports` from `cloudflare:workers`, and `TEST_ORIGIN = "http://anchor.test"`.

- [ ] **Step 1: Create the workspace.** Root `package.json` is private, with scripts `test` (`pnpm -r test`), `typecheck` (`pnpm -r typecheck`), `lint` (`biome check .`) and `format` (`biome format --write .`). `pnpm-workspace.yaml` lists `packages/*` and `apps/*`. `tsconfig.base.json` sets `strict`, `target ES2022`, `module ESNext`, `moduleResolution Bundler`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. Run `pnpm add -Dw typescript @biomejs/biome` and `pnpm biome init`, then set the formatter to 2-space indent and line width 100.

- [ ] **Step 2: Create `apps/server`.** It has dependencies `hono` and `@anchor/shared` (`workspace:*`, the package is added in Task 2, so add the dependency then), and devDependencies `wrangler`, `vitest`, `@cloudflare/vitest-plugin` and `@cloudflare/workers-types`. Its scripts are `dev` (`wrangler dev`), `test` (`vitest run`), `typecheck` (`tsc --noEmit`) and `deploy` (`wrangler deploy`). `wrangler.jsonc` sets `name: "anchor"`, `main: "src/index.ts"`, `compatibility_date: "2026-11-01"`, `compatibility_flags: ["nodejs_compat"]`, and one `d1_databases` entry with binding `DB`, `database_name: "anchor"`, a placeholder `database_id` and `migrations_dir: "migrations"`. There is no `assets` block until M4.

- [ ] **Step 3: Configure Vitest.** `vitest.config.ts` uses `cloudflareTest(async () => ({ wrangler: { configPath: "./wrangler.jsonc" }, miniflare: { bindings: { TEST_MIGRATIONS: await readD1Migrations(path.join(__dirname, "migrations")), ANCHOR_ROOT_KEY: <base64 of node:crypto randomBytes(32)>, ANCHOR_SETUP_TOKEN: "test-setup-token-0123456789abcdef" } } }))`, with `test.setupFiles: ["./test/apply-migrations.ts"]`. Import `cloudflareTest` and `readD1Migrations` from `@cloudflare/vitest-plugin`. `test/apply-migrations.ts` calls `await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` (from `cloudflare:test`, with `env` from `cloudflare:workers`). The test tsconfig `types` include `@cloudflare/vitest-plugin/types` and `@cloudflare/workers-types`. If the plugin's API differs, check the current docs at developers.cloudflare.com/workers/testing/vitest-integration/ instead of guessing.

- [ ] **Step 4: Write the failing test**

```ts
// apps/server/test/health.test.ts
import { describe, expect, it } from "vitest";
import { api } from "./helpers";

describe("GET /api/v1/health", () => {
  it("returns ok with no-store caching", async () => {
    const res = await api("/api/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
```

- [ ] **Step 5: Run it and confirm it fails.** Run `pnpm --filter ./apps/server test`. Expected: FAIL (no app / 404).

- [ ] **Step 6: Implement `createApp()`.** Add middleware on `/api/*` that sets `Cache-Control: no-store` after `next()`, and `GET /api/v1/health` returning `{ status: "ok" }`. `src/index.ts` is `export default createApp();`.

- [ ] **Step 7: Run tests, typecheck and lint.** Run `pnpm test && pnpm typecheck && pnpm lint`. Expected: all pass.

- [ ] **Step 8: Add CI.** `.github/workflows/ci.yml` runs on push and pull_request: checkout, `pnpm/action-setup`, `actions/setup-node` (node 22, pnpm cache), `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "chore: scaffold monorepo and server worker with health endpoint"
```

---

### Task 2: Shared schemas, error codes and DTOs

**Files:**
- Create: `packages/shared/package.json` (name `@anchor/shared`, `exports: { ".": "./src/index.ts" }`, dependency `zod`, devDependency `vitest`, scripts `test` and `typecheck`), `packages/shared/tsconfig.json`, `packages/shared/src/{index,schemas,errors,api}.ts`
- Test: `packages/shared/test/schemas.test.ts`
- Modify: `apps/server/package.json` (add `@anchor/shared: workspace:*`)

**Interfaces:**
- Produces (`schemas.ts`):
  - `slugSchema`, `secretKeySchema`, `passwordSchema` (string 12–1024), `emailSchema` (trimmed, lowercased, valid email, ≤ 254)
  - `secretValueSchema`: a string whose `utf8ByteLength` ≤ `MAX_SECRET_VALUE_BYTES = 65536`. The issue message is `"value exceeds 65536 bytes"`; the custom issue carries `params: { code: "payload_too_large" }`.
  - `secretPathSchema`: a string that is transformed through `normalizeSecretPath`
  - `normalizeSecretPath(input: string): string` throws `Error("invalid path")`. Behavior: `""`, `"/"` → `"/"`. A missing leading slash is added and one trailing slash is removed. Segments must match `[A-Za-z0-9_-]+`, so `//`, `.` and `..` are rejected. Max depth is 10 and max total length is 256.
  - `utf8ByteLength(s: string): number`
  - Bodies: `setupBodySchema { setupToken: string(1..512), email, name: string(1..100), password }`, `loginBodySchema { email, password: string(1..1024), client: "web" | "cli" = "web" }`, `createProjectBodySchema { name: string(1..64), slug }`, `updateProjectBodySchema { name }`, `createEnvironmentBodySchema { name: string(1..64), slug }`, `updateEnvironmentBodySchema { name }`, `putSecretBodySchema { value: secretValueSchema, comment: string(0..500) = "", path: secretPathSchema = "/" }`
  - Query: `secretQuerySchema { path: secretPathSchema = "/", reveal: "true" | "false" → boolean = false }`
- Produces (`errors.ts`): `ERROR_CODES = ["bad_request","unauthenticated","invalid_credentials","forbidden","not_found","conflict","rate_limited","setup_disabled","payload_too_large","internal"] as const`, `type ErrorCode`, `type ApiErrorBody = { error: { code: ErrorCode; message: string } }`.
- Produces (`api.ts`): `InstanceRole = "owner" | "admin" | "member"`, `UserDto { id; email; name; role: InstanceRole }`, `ProjectDto { id; slug; name; createdAt: number }`, `EnvironmentDto { id; slug; name; position: number }`, `SecretDto { key; path; version: number; comment: string; updatedAt: number; value?: string }`, `LoginResponse { user: UserDto; token?: string; expiresAt: number }`, `SetupStatusDto { needsSetup: boolean }`.

- [ ] **Step 1: Write the failing tests.** Use these cases verbatim:

```ts
import { describe, expect, it } from "vitest";
import { normalizeSecretPath, secretKeySchema, slugSchema, secretValueSchema, passwordSchema } from "../src";

describe("normalizeSecretPath", () => {
  it.each([["", "/"], ["/", "/"], ["api", "/api"], ["/api", "/api"], ["/api/", "/api"], ["/api/db", "/api/db"]])(
    "%s -> %s", (input, out) => expect(normalizeSecretPath(input)).toBe(out));
  it.each(["//", "/api//db", "/./x", "/../x", "/a b", "/" + "a/".repeat(11) + "a", "/" + "x".repeat(256)])(
    "rejects %s", (input) => expect(() => normalizeSecretPath(input)).toThrow("invalid path"));
});

describe("secretKeySchema", () => {
  it("accepts env-var names and keeps case", () => {
    expect(secretKeySchema.parse("DB_URL")).toBe("DB_URL");
    expect(secretKeySchema.parse("db_url")).toBe("db_url");
    expect(secretKeySchema.parse("_X1")).toBe("_X1");
  });
  it.each(["1ABC", "A-B", "A.B", "", "A".repeat(256)])("rejects %s", (k) =>
    expect(secretKeySchema.safeParse(k).success).toBe(false));
});

describe("slugSchema", () => {
  it.each(["dev", "my-app", "a1"])("accepts %s", (s) => expect(slugSchema.parse(s)).toBe(s));
  it.each(["Dev", "-x", "my_app", "", "a".repeat(64)])("rejects %s", (s) =>
    expect(slugSchema.safeParse(s).success).toBe(false));
});

describe("secretValueSchema", () => {
  it("accepts empty and exactly 65536 bytes", () => {
    expect(secretValueSchema.parse("")).toBe("");
    expect(secretValueSchema.safeParse("a".repeat(65536)).success).toBe(true);
    expect(secretValueSchema.safeParse("é".repeat(32768)).success).toBe(true); // 2 bytes each
  });
  it("rejects 65537 bytes", () => {
    expect(secretValueSchema.safeParse("a".repeat(65537)).success).toBe(false);
    expect(secretValueSchema.safeParse("é".repeat(32768) + "a").success).toBe(false);
  });
});

describe("passwordSchema", () => {
  it("enforces 12..1024 chars", () => {
    expect(passwordSchema.safeParse("a".repeat(11)).success).toBe(false);
    expect(passwordSchema.safeParse("a".repeat(12)).success).toBe(true);
    expect(passwordSchema.safeParse("a".repeat(1025)).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm --filter @anchor/shared test`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `schemas.ts`, `errors.ts`, `api.ts` and `index.ts`** with the interfaces above.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `pnpm --filter @anchor/shared test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(shared): add validation schemas, error codes and DTO types"`.

---

### Task 3: Error contract, validation helpers and redacting logger

**Files:**
- Create: `apps/server/src/lib/{errors,validate,log}.ts`
- Modify: `apps/server/src/app.ts` (register `onError(errorHandler)` and `notFound(notFoundHandler)`)
- Test: `apps/server/test/errors.test.ts`, `apps/server/test/log.test.ts`

**Interfaces:**
- Produces: `class ApiError extends Error { constructor(status: ContentfulStatusCode, code: ErrorCode, message: string) }`, `class ConfigError extends Error`, `class IntegrityError extends Error { constructor(message: string, readonly fields: Record<string, unknown>) }`.
- Produces: `errorHandler(err: Error, c: Context<AppEnv>): Response`, with this mapping:
  - `ApiError` → its status, code and message.
  - `ConfigError` → 500 `internal` "Internal error", logged as `config_error`.
  - `IntegrityError` → 500 `internal` "Internal error", logged as `secret_decrypt_failed` with `fields`.
  - Anything else → 500 `internal` "Internal error", logged as `unhandled_error` with `{ name: err.name }` only (never `err.message`, because it can contain user input).
- Produces: `notFoundHandler` → 404 `not_found` "Route not found".
- Produces: `parseJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>>`. It throws `ApiError(400, "bad_request", ...)` when the JSON is invalid or validation fails. The message lists `path: issueCode` pairs only, e.g. `"invalid fields: email (invalid_format)"`. When any issue carries `params.code === "payload_too_large"`, it throws 413 `payload_too_large` instead. `parseQuery<S>(c, schema)` works the same way on `c.req.query()`.
- Produces: `log(level: "info" | "warn" | "error", event: string, fields?: Record<string, unknown>): void`. It writes one JSON line `{ level, event, ...fields }` through `console.log`/`console.error`. Any key matching `/(value|password|token|secret|key|cookie|authorization)/i` at any nesting depth becomes `"[REDACTED]"`.

- [ ] **Step 1: Write the failing tests**

```ts
// errors.test.ts — build an app and add throwing routes
import { createApp } from "../src/app";
import { ApiError, IntegrityError } from "../src/lib/errors";
import { parseJson } from "../src/lib/validate";
import { putSecretBodySchema } from "@anchor/shared";
import { env } from "cloudflare:workers";
import { vi } from "vitest";
// (assume vitest imports)
const app = createApp();
app.get("/api/v1/__boom", () => { throw new Error("secret-marker-123"); });
app.get("/api/v1/__teapot", () => { throw new ApiError(409, "conflict", "already exists"); });
app.get("/api/v1/__integrity", () => { throw new IntegrityError("bad tag", { sid: "s1", version: 1 }); });
app.post("/api/v1/__body", async (c) => c.json(await parseJson(c, putSecretBodySchema)));

it("unknown route -> 404 not_found JSON", async () => {
  const res = await app.request("/api/v1/nope", {}, env);
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: { code: "not_found", message: "Route not found" } });
});
it("ApiError keeps status/code/message", async () => {
  const res = await app.request("/api/v1/__teapot", {}, env);
  expect(res.status).toBe(409);
  expect((await res.json()).error.code).toBe("conflict");
});
it("unexpected error -> 500 internal without leaking message", async () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const res = await app.request("/api/v1/__boom", {}, env);
  expect(res.status).toBe(500);
  const text = await res.text();
  expect(text).not.toContain("secret-marker-123");
  expect(JSON.stringify(spy.mock.calls)).not.toContain("secret-marker-123");
});
it("IntegrityError -> 500 internal and logs secret_decrypt_failed", async () => { /* assert status 500, code internal, logged event */ });
it("invalid body -> 400 naming field, not echoing value", async () => {
  const res = await app.request("/api/v1/__body", { method: "POST", body: JSON.stringify({ value: 42, comment: "hunter2-marker" }), headers: { "content-type": "application/json" } }, env);
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error.code).toBe("bad_request");
  expect(body.error.message).toContain("value");
  expect(JSON.stringify(body)).not.toContain("hunter2-marker");
});
it("malformed JSON -> 400", async () => { /* body "{" -> 400 bad_request */ });
it("oversized value -> 413 payload_too_large", async () => { /* value "a".repeat(65537) */ });
```

```ts
// log.test.ts
it("redacts sensitive keys at any depth and keeps others", () => {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  log("info", "test_event", { secretId: "s1", value: "v-marker", nested: { password: "p-marker", apiToken: "t-marker", name: "ok" } });
  const line = JSON.parse(spy.mock.calls[0]![0] as string);
  expect(line).toEqual({ level: "info", event: "test_event", secretId: "[REDACTED]", value: "[REDACTED]",
    nested: { password: "[REDACTED]", apiToken: "[REDACTED]", name: "ok" } });
});
```

Note: `secretId` matches `/secret/i` and is redacted on purpose. Log ids under neutral names (`sid`, `projectId`, `environmentId`, `kekVersion`). Tasks 6 and 13 follow this.

- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm --filter ./apps/server test`. Expected: FAIL.
- [ ] **Step 3: Implement `errors.ts`, `validate.ts` and `log.ts`, and register the handlers in `createApp()`.**
- [ ] **Step 4: Run the tests and confirm they pass.** Run `pnpm --filter ./apps/server test`. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(server): error contract, validation helpers and redacting logger"`.

---

### Task 4: D1 schema and test database helpers

**Files:**
- Create: `apps/server/migrations/0001_init.sql` (delete `.gitkeep`)
- Modify: `apps/server/test/helpers.ts`
- Test: `apps/server/test/schema.test.ts`

**Interfaces:**
- Produces: these tables, with exactly this DDL:

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                 -- sha256 hex of the token
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('web','cli')),
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  current_key_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE project_keys (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  root_key_id TEXT NOT NULL,
  iv BLOB NOT NULL,
  wrapped_key BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, version)
);
CREATE TABLE environments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (project_id, slug)
);
CREATE TABLE secrets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  key TEXT NOT NULL,
  current_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (environment_id, path, key)
);
CREATE TABLE secret_versions (
  secret_id TEXT NOT NULL REFERENCES secrets(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  alg TEXT NOT NULL,
  key_version INTEGER NOT NULL,
  iv BLOB NOT NULL,
  ciphertext BLOB NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (secret_id, version)
);
```

- Produces (`test/helpers.ts`): `resetDb(): Promise<void>` deletes from all tables in child-to-parent order. Tests must not assume isolated storage between files; call `resetDb()` in `beforeEach` wherever a test depends on an empty table.

- [ ] **Step 1: Write the failing tests.** In `schema.test.ts`:
  - `"email uniqueness is case-insensitive"`: insert a user with `a@x.io`, then insert `A@X.IO` → expect it to throw (UNIQUE).
  - `"secret keys are case-sensitive"`: insert `DB_URL` and `db_url` into the same env and path → both succeed.
  - `"deleting a project cascades"`: insert project → env → secret → version, delete the project, then expect `SELECT count(*) FROM secret_versions` to be 0. This proves D1 enforces foreign keys. If it does not, add `PRAGMA foreign_keys = ON` handling and record that in the spec.
- [ ] **Step 2: Run the tests and confirm they fail** (no such table).
- [ ] **Step 3: Write `0001_init.sql` and `resetDb()`.**
- [ ] **Step 4: Run the tests and confirm they pass.** Also run `pnpm --filter ./apps/server exec wrangler d1 migrations apply anchor --local`. Expected: the migration applies cleanly.
- [ ] **Step 5: Commit** with `git commit -m "feat(server): initial D1 schema"`.

---

### Task 5: AES-256-GCM primitive and encoding helpers

**Files:**
- Create: `apps/server/src/lib/encoding.ts`, `apps/server/src/lib/random.ts`, `apps/server/src/crypto/aead.ts`
- Test: `apps/server/test/aead.test.ts`

**Interfaces:**
- Produces (`encoding.ts`): `toBase64(b: Uint8Array): string`, `fromBase64(s: string): Uint8Array` (throws on invalid), `toBase64Url`, `fromBase64Url`, `toHex`, `utf8Encode(s): Uint8Array`, `utf8Decode(b): string`.
- Produces (`random.ts`): `randomBytes(n: number): Uint8Array`, `newId(): string`, `newSessionToken(): string` (`"anc_s_" + base64url(32 random bytes)`), `sha256Hex(s: string): Promise<string>`.
- Produces (`aead.ts`): `AEAD_ALG = "A256GCM"`, `importAesKey(raw: Uint8Array): Promise<CryptoKey>` (32 bytes only, non-extractable, usages encrypt and decrypt; throws `Error("AES key must be 32 bytes")` otherwise), `type Sealed = { iv: Uint8Array; ciphertext: Uint8Array }`, `seal(key: CryptoKey, plaintext: Uint8Array, aad: string): Promise<Sealed>` (12-byte random IV, 128-bit tag), `open(key: CryptoKey, sealed: Sealed, aad: string): Promise<Uint8Array>` (throws `DecryptError` on any failure).

- [ ] **Step 1: Write the failing tests** with exactly these names:
  - `round-trips arbitrary bytes including empty`
  - `fails when any single bit of ciphertext is flipped`: loop over bit positions in the first byte, the last byte (tag) and a middle byte; each one must make `open` reject with `DecryptError`
  - `fails when a bit of the IV is flipped`
  - `fails with different AAD`
  - `fails with a different key`
  - `uses a unique 12-byte IV across 10,000 seals`: put base64 IVs in a `Set` and expect size 10000
  - `importAesKey rejects 16- and 33-byte keys`
  - `importAesKey returns a non-extractable key`: `crypto.subtle.exportKey("raw", key)` rejects
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.** Use `crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8Encode(aad), tagLength: 128 }, ...)`.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(crypto): AES-256-GCM seal/open with AAD"`.

---

### Task 6: Keyring — root key and project KEKs

**Files:**
- Create: `apps/server/src/crypto/keyring.ts`
- Test: `apps/server/test/keyring.test.ts`

**Interfaces:**
- Consumes: `importAesKey`, `seal`, `open`, `DecryptError` (Task 5); `ConfigError` (Task 3).
- Produces:
  - `ROOT_KEY_ID = "rk1"`
  - `getRootKey(env: Pick<Bindings, "ANCHOR_ROOT_KEY">): Promise<CryptoKey>`. It decodes base64 and requires exactly 32 bytes; otherwise it throws `ConfigError("ANCHOR_ROOT_KEY must be 32 bytes, base64-encoded")`. The message names the variable, never its value. It caches the imported key at module level keyed by the raw string (re-imports if the string changes).
  - `kekAad(projectId: string, version: number): string`, `secretAad(p: { projectId: string; environmentId: string; secretId: string; version: number }): string` (formats from Global Constraints)
  - `type WrappedKek = { projectId: string; version: number; rootKeyId: string; iv: Uint8Array; wrappedKey: Uint8Array }`
  - `createWrappedKek(rootKey: CryptoKey, projectId: string, version: number): Promise<WrappedKek>`: generates 32 random bytes, seals them with `kekAad`, and returns the result (the raw bytes are not returned)
  - `unwrapKek(rootKey: CryptoKey, w: WrappedKek): Promise<CryptoKey>`: opens with `kekAad(w.projectId, w.version)`, then `importAesKey`. It throws `IntegrityError("kek unwrap failed", { projectId, kekVersion })` when `w.rootKeyId !== ROOT_KEY_ID` or opening fails.

- [ ] **Step 1: Write the failing tests:**
  - `getRootKey rejects missing, non-base64, and 16-byte keys with ConfigError`, and the error message does not contain the supplied string
  - `wrap then unwrap yields a working key`: seal/open a payload with the unwrapped KEK
  - `unwrap fails for a KEK moved to another project`: build a `WrappedKek` with the same iv/bytes but a different `projectId` → `IntegrityError`
  - `unwrap fails for a different version number`
  - `unwrap fails under a different root key` (Review Focus 3)
  - `unwrap fails for unknown rootKeyId`
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement `keyring.ts`.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(crypto): root key import and project KEK wrapping"`.

---

### Task 7: Password hashing

**Files:**
- Create: `apps/server/src/crypto/password.ts`
- Test: `apps/server/test/password.test.ts`

**Interfaces:**
- Produces: `PBKDF2_ITERATIONS = 100_000`, `hashPassword(password: string): Promise<string>`, `verifyPassword(password: string, stored: string): Promise<boolean>`, `verifyAgainstDummy(password: string): Promise<false>` (runs a full verification against a lazily computed module-level dummy hash, always returns false; used for unknown emails).
- `verifyPassword` returns `false` (never throws) when the format is malformed, the algorithm is unknown, iterations are outside `[10_000, 100_000]`, or the salt or hash length is wrong. It compares with `crypto.subtle.timingSafeEqual`.

- [ ] **Step 1: Write the failing tests:**
  - `workerd accepts 100,000 PBKDF2 iterations`: `hashPassword` resolves. This pins the platform limit from spec §12.
  - `hash has the documented format`: matches `/^pbkdf2-sha256\$100000\$[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{44}$/`
  - `same password hashes differently (random salt)`
  - `verify succeeds for the right password and fails for a wrong one, including one-char difference and different case`
  - `verify returns false for malformed stored strings`: `""`, `"pbkdf2-sha256$100000$abc"`, `"bcrypt$..."`, `"pbkdf2-sha256$999999999$<salt>$<hash>"` (refuses the DoS iteration count), `"pbkdf2-sha256$100000$<bad b64>$<hash>"`
  - `verifyAgainstDummy returns false`
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement** with `crypto.subtle.importKey("raw", utf8(password), "PBKDF2", false, ["deriveBits"])` and `deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256)`.
- [ ] **Step 4: Run the tests and confirm they pass.** If the 100k test fails, stop and report: the spec's iteration count must change.
- [ ] **Step 5: Commit** with `git commit -m "feat(crypto): PBKDF2 password hashing"`.

---

### Task 8: Sessions, authentication middleware, `GET /auth/me`, `POST /auth/logout`

**Files:**
- Create: `apps/server/src/users/repo.ts`, `apps/server/src/auth/sessions.ts`, `apps/server/src/auth/middleware.ts`, `apps/server/src/auth/routes.ts`
- Modify: `apps/server/src/app.ts` (apply `authenticate` to `/api/*`, apply `checkOrigin` to `/api/*`, mount `authRoutes` at `/api/v1`), `apps/server/test/helpers.ts`
- Test: `apps/server/test/sessions.test.ts`

**Interfaces:**
- Produces (`users/repo.ts`): `type UserRow = { id; email; name; password_hash; role: InstanceRole; failed_logins: number; locked_until: number | null }`, `findUserByEmail(db, email): Promise<UserRow | null>`, `findUserById(db, id)`, `insertUser(db, u: { email; name; passwordHash; role }, now): Promise<string>` (returns the id), `insertFirstOwner(db, u: { email; name; passwordHash }, now): Promise<string | null>` (`INSERT ... SELECT ... WHERE NOT EXISTS (SELECT 1 FROM users)`; returns null when `meta.changes === 0`), `updateLoginState(db, userId, s: { failedLogins: number; lockedUntil: number | null })`, `toUserDto(u: UserRow): UserDto`.
- Produces (`sessions.ts`): `SESSION_COOKIE = "__Host-anchor_session"`, `SESSION_TTL_MS = { web: 7 * 86_400_000, cli: 30 * 86_400_000 }`, `createSession(db, userId: string, kind: "web" | "cli", userAgent: string | null, now: number): Promise<{ token: string; expiresAt: number }>`, `findPrincipalBySessionToken(db, token: string, now: number): Promise<Principal | null>` (null for unknown or expired; also updates `last_used_at`), `revokeSession(db, token: string): Promise<void>`, `setSessionCookie(c, token, expiresAt)`, `clearSessionCookie(c)`.
- Produces (`middleware.ts`):
  - `authenticate` reads the `Authorization: Bearer anc_s_...` header first, else the session cookie, and sets `c.var.principal` and `c.var.authVia: "cookie" | "bearer"`. A missing or invalid credential does not throw. Add `authVia` to `AppEnv.Variables`.
  - `requireUser(c): Principal` throws 401 `unauthenticated` "Authentication required".
  - `checkOrigin` applies when the method is POST/PUT/PATCH/DELETE and `authVia === "cookie"`: it requires `Origin === new URL(c.req.url).origin`, else 403 `forbidden` "Origin check failed".
- Produces (routes): `GET /api/v1/auth/me` → `{ user: UserDto }`. `POST /api/v1/auth/logout` → 204: it revokes the presented session and clears the cookie, and returns 204 even when not logged in.
- Produces (helpers): `createUserWithSession(opts?: { role?: InstanceRole; kind?: "web" | "cli"; email?: string; password?: string }): Promise<{ userId: string; token: string; cookie: string }>` (inserts the user with a real hash, defaults: role `owner`, password `"correct horse battery staple"`), `jsonInit(method: string, body: unknown, auth?: { cookie?: string; token?: string; origin?: string | null }): RequestInit` (sets content-type and the cookie or Bearer header; when a cookie is used, `Origin` defaults to `TEST_ORIGIN` and `origin: null` omits it).

- [ ] **Step 1: Write the failing tests:**
  - `me returns the user for a valid cookie`
  - `me returns the user for a valid bearer token`
  - `me is 401 with no credentials, an unknown token, a malformed header ("Bearer"), and an expired session` (expire it by updating `expires_at` to `Date.now() - 1`)
  - `logout revokes immediately`: after logout, the same token → 401 on `/auth/me` (both cookie and bearer)
  - `logout response clears the cookie`: the `Set-Cookie` header contains `__Host-anchor_session=;` and `Max-Age=0`
  - `cookie POST without Origin -> 403`, `cookie POST with foreign Origin -> 403`, `bearer POST without Origin -> allowed` (use `POST /auth/logout` as the probe)
  - `session row stores only the hash`: `SELECT id FROM sessions` ≠ the token, and equals `sha256Hex(token)`
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement the repo, sessions, middleware and the two routes.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(auth): sessions, auth middleware, me and logout"`.

---

### Task 9: First-owner setup

**Files:**
- Modify: `apps/server/src/auth/routes.ts`
- Test: `apps/server/test/setup.test.ts`

**Interfaces:**
- Consumes: `insertFirstOwner`, `hashPassword`, `createSession`, `setSessionCookie`, `parseJson(setupBodySchema)`.
- Produces: `GET /api/v1/setup/status` → `{ needsSetup: boolean }` (no auth). `POST /api/v1/setup` → 201 `LoginResponse` (web session cookie set, no `token` field). Error order:
  1. Setup token unset or empty → 503 `setup_disabled`.
  2. Body invalid → 400.
  3. Token mismatch → 403 `forbidden` "Invalid setup token". Compare `sha256(provided)` against `sha256(expected)` with `timingSafeEqual`.
  4. Users already exist → 409 `conflict` "Instance already set up".

- [ ] **Step 1: Write the failing tests** (call `resetDb()` in `beforeEach`; the `setup_disabled` case uses `createApp().request(path, init, { ...env, ANCHOR_SETUP_TOKEN: undefined })`):
  - `status reports needsSetup true on empty db and false after setup`
  - `setup creates an owner, sets the cookie and the cookie works on /auth/me`
  - `wrong setup token -> 403 and no user created`
  - `setup token of different length -> 403` (guards against `timingSafeEqual` throwing on unequal lengths)
  - `missing ANCHOR_SETUP_TOKEN -> 503 setup_disabled even with a body` (Review Focus 1)
  - `second setup -> 409 and the first owner is unchanged`
  - `weak password -> 400 and no user`
  - `email is stored lowercased`
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement the two routes.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(auth): first-owner setup guarded by setup token"`.

---

### Task 10: Login with lockout

**Files:**
- Create: `apps/server/src/auth/lockout.ts`
- Modify: `apps/server/src/auth/routes.ts`
- Test: `apps/server/test/lockout.test.ts`, `apps/server/test/login.test.ts`

**Interfaces:**
- Produces (`lockout.ts`): `MAX_FAILED_LOGINS = 5`, `LOCKOUT_MS = 900_000`, `type LockState = { failedLogins: number; lockedUntil: number | null }`, `isLocked(s: LockState, now: number): boolean`, `nextLockState(s: LockState, outcome: "success" | "failure", now: number): LockState`. A success resets to `{0, null}`. A failure increments the count; reaching 5 sets `lockedUntil = now + LOCKOUT_MS` and resets the count to 0. An expired lock counts as unlocked.
- Produces: `POST /api/v1/auth/login` (`loginBodySchema`). Behavior:
  - Unknown email → `verifyAgainstDummy`, then 401 `invalid_credentials` "Invalid email or password".
  - Locked → 429 `rate_limited` "Too many failed attempts, try again later". Do not verify the password and do not change state.
  - Wrong password → update state, then 401 `invalid_credentials`.
  - Success → reset state and create a session whose kind is the body's `client` value.
    - For `web`: set the cookie and return 200 `{ user, expiresAt }`.
    - For `cli`: return 200 `{ user, token, expiresAt }` without a cookie.
  - No special case for `checkOrigin`: it only applies when a cookie authenticated the request, which is the rule from Task 8.

- [ ] **Step 1: Write the failing tests.**
  - Unit tests for `nextLockState`/`isLocked`: 4 failures → not locked; the 5th → locked until `now + 900000`; locked at `now + 899999`, unlocked at `now + 900000`; success resets the count.
  - Integration tests:
    - `web login sets the cookie and no token`
    - `cli login returns a token usable as bearer`
    - `wrong password and unknown email return identical status and body`
    - `email lookup is case-insensitive`
    - `5 failures lock the account; correct password then gets 429`
    - `after lockout expires, the correct password works`: set `locked_until` to the past in the DB
    - `successful login resets failed_logins to 0`
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(auth): password login with lockout"`.

---

### Task 11: Authorization seam and projects

**Files:**
- Create: `apps/server/src/authz/policy.ts`, `apps/server/src/projects/repo.ts`, `apps/server/src/projects/routes.ts`
- Modify: `apps/server/src/app.ts` (mount `projectRoutes` at `/api/v1/projects`)
- Test: `apps/server/test/authz.test.ts`, `apps/server/test/projects.test.ts`

**Interfaces:**
- Produces (`policy.ts`): `type Action = "project:create" | "project:read" | "project:update" | "project:delete" | "environment:manage" | "secret:read" | "secret:write"`, `authorize(principal: Principal, action: Action, resource?: { projectId: string }): void`. M1 rule: `owner`/`admin` are allowed; everything else throws `ApiError(403, "forbidden", "You do not have permission to perform this action")`. Add a `// M2: memberships, env restrictions, service-token scopes` comment at the decision point.
- Produces (`projects/repo.ts`):
  - `type ProjectRow = { id; slug; name; current_key_version: number; created_at: number }`, `type EnvironmentRow = { id; project_id; slug; name; position: number }`
  - `DEFAULT_ENVIRONMENTS = [{ slug: "dev", name: "Development" }, { slug: "staging", name: "Staging" }, { slug: "prod", name: "Production" }]`
  - `createProject(db, rootKey: CryptoKey, input: { name: string; slug: string }, now): Promise<ProjectRow>`: one `db.batch([...])` inserts the project (`current_key_version = 1`), the KEK v1 from `createWrappedKek`, and the 3 environments (positions 0, 1, 2). A UNIQUE violation on slug → `ApiError(409, "conflict", "Project slug already exists")`.
  - `listProjects(db): Promise<ProjectRow[]>` ordered by name. `getProjectBySlug(db, slug): Promise<ProjectRow>` throws 404 `not_found` "Project not found". `updateProjectName(db, id, name, now)`. `deleteProject(db, id)`.
  - `getProjectKek(db, rootKey, project: ProjectRow, version?: number): Promise<CryptoKey>` loads `project_keys` and calls `unwrapKek`.
  - `toProjectDto(row): ProjectDto`
- Produces (routes): `GET /` → `{ projects: ProjectDto[] }` (`project:read`). `POST /` → 201 `{ project }` (`project:create`). `GET /:project` → `{ project }`. `PATCH /:project` → `{ project }` (`project:update`). `DELETE /:project` → 204 (`project:delete`). All of these require a user.

- [ ] **Step 1: Write the failing tests:**
  - `authorize allows owner and admin for every action and denies member for every action` (table-driven over all `Action` values)
  - `create project provisions dev/staging/prod and KEK v1`: query `environments` and `project_keys`
  - `KEK row never contains raw key material`: `wrapped_key` length is 48 (32 + 16-byte tag), and `getProjectKek` returns a key that decrypts what it encrypts
  - `duplicate slug -> 409`, `invalid slug "My App" -> 400`
  - `member gets 403 on list and create`, `unauthenticated gets 401`
  - `patch renames but cannot change slug` (a `slug` in the PATCH body is ignored)
  - `delete cascades environments, keys and secrets`
  - `unknown project -> 404`
  - `create with malformed ANCHOR_ROOT_KEY -> 500 internal and nothing inserted`: use `createApp().request(..., { ...env, ANCHOR_ROOT_KEY: "short" })` (Review Focus 3)
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement the policy, repo and routes.** Each handler calls `requireUser(c)` and then `authorize(...)` before touching data.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(projects): authorization seam and project CRUD with KEK provisioning"`.

---

### Task 12: Environments

**Files:**
- Modify: `apps/server/src/projects/repo.ts`, `apps/server/src/projects/routes.ts`
- Test: `apps/server/test/environments.test.ts`

**Interfaces:**
- Produces (repo): `listEnvironments(db, projectId): Promise<EnvironmentRow[]>` ordered by `position`, `getEnvironmentBySlug(db, projectId, slug): Promise<EnvironmentRow>` (404 "Environment not found"), `createEnvironment(db, projectId, { name, slug }, now)` (position = max + 1; duplicate → 409), `renameEnvironment(db, envId, name)`, `deleteEnvironment(db, projectId, envId)` (409 `conflict` "A project must keep at least one environment" when it is the last one), `toEnvironmentDto`.
- Produces (routes under `/api/v1/projects/:project/environments`): `GET /` → `{ environments }` (`project:read`). `POST /` → 201 `{ environment }`, and `PATCH /:env` → `{ environment }` (both `environment:manage`). `DELETE /:env` → 204 (`environment:manage`, cascades secrets).

- [ ] **Step 1: Write the failing tests:**
  - `lists default envs in order dev, staging, prod`
  - `creates qa at position 3`, `duplicate slug -> 409`, `invalid slug -> 400`
  - `rename keeps slug`
  - `delete removes the env and its secrets`
  - `deleting the last env -> 409`
  - `env of another project is not reachable`: `/projects/a/environments/<b's env slug that a lacks>` → 404
  - `member -> 403`
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(projects): environment management"`.

---

### Task 13: Secrets service — encryption, versions and idempotent writes

**Files:**
- Create: `apps/server/src/secrets/repo.ts`, `apps/server/src/secrets/service.ts`
- Test: `apps/server/test/secrets-service.test.ts`

**Interfaces:**
- Consumes: `getRootKey`, `getProjectKek`, `secretAad`, `seal`, `open`, `DecryptError`, `IntegrityError`, `ProjectRow`, `EnvironmentRow`.
- Produces (`service.ts`):
  - `type SecretContext = { db: D1Database; rootKey: CryptoKey; project: ProjectRow; environment: EnvironmentRow; actorId: string | null; now: number }`
  - `putSecret(ctx, input: { path: string; key: string; value: string; comment: string }): Promise<{ secret: SecretDto; created: boolean; changed: boolean }>`. Behavior:
    - New key: one batch inserts the `secrets` row (`current_version = 1`) and version 1. A UNIQUE violation means a concurrent create → 409 `conflict` "Secret was modified concurrently, retry".
    - Existing key: decrypt the current version. When the value and comment are equal, return `changed: false` without writing. Otherwise one batch inserts version `n+1` and then runs `UPDATE secrets SET current_version = n+1, updated_at = ? WHERE id = ?`. A PRIMARY KEY violation on the version insert → the same 409.
    - Values are encrypted with the project's current KEK (`key_version = project.current_key_version`), `alg = AEAD_ALG`, and AAD `secretAad({ projectId, environmentId, secretId, version })`.
  - `listSecrets(ctx, { path: string; reveal: boolean }): Promise<SecretDto[]>`: secrets at exactly `path`, ordered by key. `value` is present only when `reveal` is true.
  - `getSecret(ctx, { path, key }): Promise<SecretDto>`: always includes `value`. Unknown → 404 "Secret not found".
  - `deleteSecret(ctx, { path, key }): Promise<void>`: 404 when unknown.
  - Decrypt failure → throw `IntegrityError("secret decrypt failed", { sid, version })`.
  - Cache unwrapped KEKs per call in a `Map<number, CryptoKey>`. Never store them at module level.

- [ ] **Step 1: Write the failing tests.** Build the context by creating a project via `createProject` with a real root key from `env`.
  - `round-trips values byte-exact`: `""`, a 3-line PEM block with a trailing `\n`, `"🔑 ünïcødé"`, `"a".repeat(65536)` (Review Focus 4; the 65,537 rejection is covered at the route level in Task 14)
  - `stored ciphertext does not contain the plaintext`: put `"plaintext-marker-xyz"` and expect the bytes of `SELECT ciphertext` not to contain the UTF-8 marker
  - `update creates version 2 and keeps version 1`
  - `identical put is a no-op`: `changed: false`, still 1 version row
  - `comment-only change creates a new version`
  - `same key in different paths and environments are independent`
  - `keys are case-sensitive`: `DB_URL` and `db_url` coexist (Review Focus 5)
  - `list hides values unless reveal`
  - `concurrent write loses with 409 and leaves no partial state` (Review Focus 2): put v1, manually insert a `secret_versions` row for version 2, then put a new value → expect `ApiError` 409, `current_version` still 1, and exactly 2 version rows (1 plus the manual one)
  - `ciphertext moved to another environment fails closed`: copy `iv/ciphertext` from env A's version into env B's secret version row via SQL, then `getSecret` on B rejects with `IntegrityError`
  - `ciphertext moved to another version number fails closed`
  - `wrong root key fails closed`: build the context with a freshly generated root key, then `getSecret` rejects with `IntegrityError` (Review Focus 3)
  - `delete removes the secret and its versions`, `get/delete unknown -> 404`
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement the repo (plain SQL functions) and the service.** For the D1 UNIQUE/PK detection, check the error message for `UNIQUE constraint failed` or `PRIMARY KEY` (verify the actual D1 error text in the failing test before matching on it).
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(secrets): encrypted, versioned secret storage"`.

---

### Task 14: Secrets HTTP API, no-plaintext-in-logs check, and deploy guide

**Files:**
- Create: `apps/server/src/secrets/routes.ts`, `apps/server/.dev.vars.example`, `docs/deploy.md`
- Modify: `apps/server/src/app.ts`, `README.md` (create: one paragraph plus dev quickstart)
- Test: `apps/server/test/secrets-api.test.ts`, `apps/server/test/no-leak.test.ts`

**Interfaces:**
- Consumes: the Task 13 service, `getProjectBySlug`, `getEnvironmentBySlug`, `parseQuery(secretQuerySchema)`, `parseJson(putSecretBodySchema)`, `secretKeySchema`.
- Produces (routes under `/api/v1/projects/:project/environments/:env/secrets`):
  - `GET /?path=&reveal=` → `{ secrets: SecretDto[] }` (`secret:read`)
  - `GET /:key?path=` → `{ secret: SecretDto }` with value (`secret:read`)
  - `PUT /:key` (body `{ value, comment?, path? }`) → 201 `{ secret }` when created, else 200. The response never includes `value`. (`secret:write`)
  - `DELETE /:key?path=` → 204 (`secret:write`)
  - An invalid `:key` → 400. Each handler: `requireUser` → `authorize` → resolve project/env → `getRootKey` → service.

- [ ] **Step 1: Write the failing tests** (`secrets-api.test.ts`):
  - `put then get round-trips over HTTP (bearer)`
  - `put via cookie without Origin -> 403`
  - `put returns 201 then 200 and never echoes value`
  - `path spellings api, /api, /api/ address the same secret`; `path=/../x -> 400` (Review Focus 5)
  - `value of 65537 bytes -> 413 payload_too_large` (Review Focus 4)
  - `invalid key "1BAD" -> 400`
  - `list without reveal has no value field; with reveal=true has values`
  - `member -> 403 on read and write`, `no auth -> 401`
  - `unknown project/env/key -> 404`
  - `malformed ANCHOR_ROOT_KEY -> 500 internal on get, body has no key material` (Review Focus 3)
- [ ] **Step 2: Write `no-leak.test.ts`.** Spy on `console.log/info/warn/error/debug`. Run setup → login (cli) → create project → put a secret with value `"LEAK-CANARY-7f3a"` → get → list with reveal → put the same value → delete. Also log in with password `"PW-CANARY-9b2c..."` (a wrong one) once. Then assert that no spied call's serialized arguments contain `LEAK-CANARY-7f3a`, `PW-CANARY-9b2c`, or the session token string.
- [ ] **Step 3: Run the tests and confirm they fail.**
- [ ] **Step 4: Implement the routes and mount them.**
- [ ] **Step 5: Run the full suite.** Run `pnpm lint && pnpm typecheck && pnpm test`. Expected: all pass.
- [ ] **Step 6: Write the docs.** `.dev.vars.example` lists `ANCHOR_ROOT_KEY=` and `ANCHOR_SETUP_TOKEN=` with comments showing `openssl rand -base64 32` (empty values only). `docs/deploy.md` covers:
  1. Workers Paid plan required (spec §12).
  2. `wrangler d1 create anchor` and paste the id into `wrangler.jsonc`.
  3. `wrangler d1 migrations apply anchor --remote`.
  4. `openssl rand -base64 32 | wrangler secret put ANCHOR_ROOT_KEY`, and **back it up offline: losing it loses all secrets**.
  5. `wrangler secret put ANCHOR_SETUP_TOKEN` with a random value.
  6. `wrangler deploy`.
  7. `curl -X POST https://<host>/api/v1/setup` with a JSON example.
  8. Optionally delete `ANCHOR_SETUP_TOKEN` after setup.
- [ ] **Step 7: Run a local smoke test.** Create `apps/server/.dev.vars` from the example with generated values (do not commit it). Run `pnpm --filter ./apps/server exec wrangler d1 migrations apply anchor --local`, then `pnpm --filter ./apps/server dev`. With curl: POST setup, then login with `client: "cli"`, then `POST /projects` with the bearer token, then `PUT .../environments/dev/secrets/HELLO` with `{"value":"world"}`, then `GET` it. Expected: `"value":"world"`. Confirm `git status` does not show `.dev.vars`.
- [ ] **Step 8: Commit** with `git add -A && git commit -m "feat(secrets): secrets HTTP API, leak test and deploy guide"`.

---

## Later milestones (separate plans)

M2 Access control & audit · M3 CLI · M4 Dashboard · M5 Advanced secrets. Scope is in spec §11. Write each plan when its predecessor has merged, against the code as it then exists.

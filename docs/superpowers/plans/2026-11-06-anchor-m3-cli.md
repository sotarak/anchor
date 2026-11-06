# Anchor M3 — CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every task touching the CLI also follows the `building-cli` skill.

**Goal:** Ship the `anchor` CLI. Developers can log in, link a directory to a project, manage secrets, inject them into a process (`anchor run`), export them, and issue service tokens for CI. It is distributed as single-file Bun binaries plus a Node bundle.

**Architecture:** `apps/cli` is a TypeScript package in the monorepo that imports schemas and DTOs from `@anchor/shared`.
- Command handlers are thin. They take an injected `CommandContext` (API client, output, config, prompts, process spawners), so unit tests need no terminal, network or OS keychain.
- A typed API client wraps `fetch` with timeouts and bounded retries.
- Credentials live in the OS keychain (macOS `security`, Linux `secret-tool`). Otherwise they go to a 0600 file. Tokens never travel through argv.
- End-to-end tests drive the CLI as a child process against a local Worker started with Wrangler.

**Tech Stack:** TypeScript 5, `commander` (latest major, currently 15), `@inquirer/prompts`, zod v4 (through `@anchor/shared`), Vitest, `tsx` (dev runner), esbuild (Node bundle), Bun `build --compile` (binaries, release only), Wrangler `createTestHarness` (e2e).

**Spec:** `docs/superpowers/specs/2026-11-06-anchor-design.md`. Read §6.3, §7, §8 and §13 (especially §13.1, §13.4 and §13.7) before starting. This plan consumes the M1 plan (`2026-11-06-anchor-m1-core-api.md`) and the M2 plan (`2026-11-06-anchor-m2-*.md` in the same folder) as merged code.

## Global Constraints

- Node ≥ 22 for development and for the npm bundle. Code uses only `node:` built-ins that Bun also supports (`child_process`, `fs/promises`, `os`, `path`, `readline`, `crypto`). No native addons.
- The package is `apps/cli`. Its npm name is `@anchor-secrets/cli`, a **placeholder**: keep `"private": true` until the owner confirms the name. The binary name is `anchor`.
- Code, comments, help text, messages and docs are in English.
- **Secret values and tokens never come from argv**, never appear in a spawned helper's argv, and are never printed by default. They are never written to `--debug` output, error messages or logs. The CLI has no `--token` and no `--value` flag.
- stdout carries data only. Progress, prompts, hints, warnings and errors go to stderr. `--json` output on stdout is always a single valid JSON document.
- Color is used only when the target stream is a TTY, `NO_COLOR` is unset, `TERM` is not `dumb`, and `--no-color` is absent.
- Exit codes (spec §13.7; stable public contract):

  | Code | Meaning |
  |------|---------|
  | `0` | ok |
  | `1` | error |
  | `2` | usage |
  | `3` | auth required / invalid credentials |
  | `4` | forbidden |
  | `5` | not found |
  | `6` | conflict |

  `anchor run` instead exits with the child's code: 127 when the command is not found, 128 + N when the child was killed by signal N.
- Config precedence: flags > `ANCHOR_*` env vars > `.anchor.json` (nearest, walking up from cwd) > user config > defaults (`env = "dev"`, `path = "/"`, no default API URL).
- Env vars: `ANCHOR_API_URL`, `ANCHOR_PROJECT`, `ANCHOR_ENV`, `ANCHOR_PATH`, `ANCHOR_TOKEN`, `ANCHOR_CREDENTIAL_STORE` (`auto` | `file`), `NO_COLOR`.
- User config dir: `$XDG_CONFIG_HOME/anchor`, else `~/.config/anchor` on macOS/Linux, `%APPDATA%\anchor` on Windows. It holds `config.json` (`{ apiUrl? }`) and, for the file store only, `credentials.json`.
- The API URL is stored and compared as an origin (`new URL(x).origin`). `https:` is required except for `localhost`, `127.0.0.1` and `[::1]`.
- HTTP: 15 s timeout per request. Retries happen only for `GET` and `PUT` (the secret PUT is idempotent by API contract): at most 2 retries, with delays of 250 ms and then 1000 ms, on network errors, 429, 502, 503 and 504. `POST` and `DELETE` are never retried.
- `User-Agent: anchor-cli/<version> (<platform>-<arch>)`.
- Tests: Vitest in Node. POSIX-specific tests (`chmod` modes, signals) use `it.skipIf(process.platform === "win32")`.
- Test layout follows `docs/testing.md`. The first level under `apps/cli/test/` is the layer: `unit/` (pure logic, plus modules whose only collaborators are injected fakes), `integration/` (commands run through `runCli` with fakes, and anything touching temp dirs or real child processes), `e2e/` (the built CLI against a local Worker). Below the layer, paths mirror `src/`. Shared helpers live in `test/support/`, split by concern and re-exported from `test/support/index.ts`. Tests import helpers through `#test/support` and source through `#src/...` (Node subpath `imports` in `apps/cli/package.json`), never through relative `../../src` paths.

## Review Focus

1. **A token is exposed through process arguments or diagnostics.** This covers keychain helper argv, `--debug` lines, error messages, and an accidental `anchor secrets set KEY=value` or `--value`. The expectation is that the token or value appears only in helper stdin and never in argv, stderr or stdout. Tests are in Task 2 (debug), Task 4 (spawned argv assertions) and Task 7 (`--value`, `KEY=value`).
2. **`anchor run` in bad conditions:**
   - The fetch fails (network, 401, 403): the child must never start (fail closed).
   - The command does not exist: exit 127.
   - The child is killed by SIGKILL: exit 137.
   - SIGTERM is sent to `anchor`: it reaches the child, and `anchor` exits with the child's code.

   Tests are in Task 8.
3. **A repository's `.anchor.json` is malicious or careless.** If it contains a token or unknown keys, the CLI refuses to read it. If it points `apiUrl` at another host, `ANCHOR_TOKEN` is never sent to an API URL that came only from the project file (so a PR cannot exfiltrate the CI token), and `anchor login` shows the target origin and warns when it differs from the user config. Tests are in Tasks 3 and 5.
4. **`export` leaves a readable or committed file:**
   - The target already exists with mode 0644: it ends up 0600.
   - The target is not gitignored: a warning is printed.
   - stdout is a terminal: the CLI refuses unless output is piped or `--output` is given.
   - A value contains both `"` and a newline: the dotenv output fails clearly, never silently corrupts.

   Tests are in Task 9.
5. **Non-interactive misuse:**
   - `secrets delete` or `tokens revoke` in CI without `--yes`: exit 2, nothing deleted.
   - `anchor login` without a TTY and without `--password-stdin`: exit 2.
   - Login to `http://` on a non-local host: exit 2 before any password is read.
   - An expired or revoked session: exit 3 with "Run 'anchor login'".

   Tests are in Tasks 5, 7 and 10.

---

## File Structure

```
apps/cli/
  package.json                private, name @anchor-secrets/cli (placeholder), bin anchor -> dist/anchor.mjs,
                              imports { "#src/*": "./src/*.ts", "#test/support": "./test/support/index.ts" }
  tsconfig.json, vitest.config.ts (excludes test/e2e/**), vitest.e2e.config.ts, build.mjs (esbuild bundle)
  src/main.ts                 entry: main(argv, deps?) -> exit code; bin wrapper sets process.exitCode
  src/program.ts              buildProgram(deps): Command — all commands, global flags, help text
  src/context.ts              CliDeps, CommandContext, createContext(), requireProject()
  src/io.ts                   Io (streams, TTY flags, env, cwd, platform), createNodeIo()
  src/output.ts               Output (data/info/warn/error/debug), shouldUseColor(), table()
  src/errors.ts               EXIT, CliError, exitCodeForApiError()
  src/prompts.ts              Prompts interface + inquirer-backed implementation (writes to stderr)
  src/version.ts              CLI_VERSION
  src/api/client.ts           ApiClient (typed endpoints), ApiRequestError
  src/api/http.ts             request(): timeout, retry, error mapping, debug line
  src/api/proxy.ts            configureProxyFromEnv()
  src/config/api-url.ts       normalizeApiUrl()
  src/config/project-file.ts  projectFileSchema, findProjectFile(), readProjectFile(), writeProjectFile()
  src/config/user-config.ts   userConfigDir(), readUserConfig(), writeUserConfig()
  src/config/resolve.ts       resolveConfig()
  src/credentials/types.ts    StoredCredential, CredentialStore, Spawner, encode/decodeCredential()
  src/credentials/macos.ts    createMacosKeychainStore()
  src/credentials/linux.ts    createSecretServiceStore()
  src/credentials/file.ts     createFileStore()
  src/credentials/select.ts   selectCredentialStore()
  src/process/spawner.ts      createNodeSpawner() (captured helper processes)
  src/process/run-child.ts    createNodeRunChild(), exitCodeFromChild()
  src/auth.ts                 resolveAuth(), authedApi()
  src/secret-input.ts         readSecretValue(), assertNoSecretInArgv()
  src/confirm.ts              confirmDestructive()
  src/format/env-file.ts      formatDotenv(), formatJson(), formatYaml()
  src/files.ts                writeSecretFile(), isGitIgnored()
  src/commands/{login,logout,whoami,init,projects,envs,secrets,run,export,tokens}.ts
  test/support/index.ts       entry point for `#test/support`; re-exports io, fakes, fs
  test/support/io.ts          createTestIo(), runCli()
  test/support/fakes.ts       fakeApi(), fakePrompts(), fakeSpawner()
  test/support/fs.ts          tmpDir()
  test/support/fixtures/child.mjs   fixture child process for run-child tests
  test/unit/                  mirrors src/ (pure logic and injected-fake tests):
    output.test.ts, auth.test.ts, secret-input.test.ts, help.test.ts, __snapshots__/help.test.ts.snap
    api/client.test.ts
    config/api-url.test.ts
    credentials/{types,macos,linux,select}.test.ts
    format/env-file.test.ts
  test/integration/           mirrors src/ (runCli with fakes, temp dirs, real child processes):
    main.test.ts, build.test.ts
    commands/{login,init,discovery,secrets,run,export,tokens}.test.ts
    config/config.test.ts
    credentials/{file,macos-real}.test.ts
    process/run-child.test.ts
  test/e2e/harness.ts, test/e2e/cli.e2e.test.ts
docs/cli.md
.github/workflows/ci.yml (modify), .github/workflows/release-cli.yml (create)
```

---

### Task 0: Reconcile with merged M1/M2 code

**Files:**
- Modify: this plan (only if needed)

- [ ] **Step 1:** Read `packages/shared/src/{schemas,errors,api}.ts` and the route files under `apps/server/src/**/routes.ts`. For each item in "Consumes" below, confirm that the name, path, body and response shape exist exactly. Expected items:
  - `LoginResponse`, `UserDto`, `ProjectDto`, `EnvironmentDto`, `SecretDto`, `ServiceTokenDto`
  - `ERROR_CODES`, `slugSchema`, `secretKeySchema`, `secretPathSchema`, `normalizeSecretPath`
  - `POST /auth/login` with `client: "cli"`, `POST /auth/logout`, `GET /auth/me` returning `{ user }` or `{ serviceToken }`
  - Projects, environments and secrets routes from spec §13.4 / M1 Task 14
  - `GET/POST /projects/:p/service-tokens`, `DELETE /projects/:p/service-tokens/:id`
- [ ] **Step 2:** For every mismatch, edit the Interfaces blocks in this plan to match the code. The code wins unless it contradicts the spec, in which case stop and report. Record the edits in a short "Reconciliation notes" list at the end of this file.
- [ ] **Step 3: Commit** (if changed) with `git commit -m "docs(plan): reconcile M3 plan with merged API"`.

---

### Task 1: Package scaffold, IO/output layer, exit codes

**Files:**
- Create: `apps/cli/package.json`, `apps/cli/tsconfig.json`, `apps/cli/vitest.config.ts`, `apps/cli/src/{main,program,context,io,output,errors,version,prompts}.ts`, `apps/cli/test/support/{index,io,fakes,fs}.ts`
- Test: `apps/cli/test/unit/output.test.ts`, `apps/cli/test/integration/main.test.ts`

**Interfaces:**
- Produces (`errors.ts`): `EXIT = { OK: 0, ERROR: 1, USAGE: 2, AUTH: 3, FORBIDDEN: 4, NOT_FOUND: 5, CONFLICT: 6 } as const`, `type ExitCode`, `class CliError extends Error { constructor(readonly exitCode: number, message: string, readonly hint?: string) }`.
- Produces (`io.ts`): `interface Io { stdout: { write(s: string): void }; stderr: { write(s: string): void }; readStdin(): Promise<string>; stdinIsTTY: boolean; stdoutIsTTY: boolean; stderrIsTTY: boolean; env: Record<string, string | undefined>; cwd: string; platform: NodeJS.Platform; homeDir: string }` and `createNodeIo(): Io`.
- Produces (`output.ts`): `shouldUseColor(stream: "stdout" | "stderr", io: Io, noColorFlag: boolean): boolean` and `class Output`:
  - Constructor: `constructor(io: Io, opts: { json: boolean; quiet: boolean; noColor: boolean; debug: boolean })`.
  - `data(json: unknown, human: () => string): void`: under `--json` it writes `JSON.stringify(json, null, 2) + "\n"` to stdout; otherwise it writes `human()` to stdout, adding a trailing newline when it is missing.
  - `raw(text: string): void`: writes to stdout as-is (used by `secrets get` when piped and by `export`).
  - `info(msg)`: stderr; suppressed by `--quiet` and by `--json`.
  - `warn(msg)`: stderr with prefix `warning: `.
  - `error(err: CliError)`: stderr as `error: <message>`, plus `hint: <hint>` on the next line when present.
  - `debug(line)`: stderr with prefix `debug: `, only when `--debug` is set.
  - `table(headers: string[], rows: string[][]): string`: space-padded columns, no borders.
- Produces (`prompts.ts`): `interface Prompts { input(o: { message: string; default?: string }): Promise<string>; password(o: { message: string }): Promise<string>; confirm(o: { message: string; default?: boolean }): Promise<boolean>; select<T extends string>(o: { message: string; choices: { name: string; value: T }[] }): Promise<T> }` and `createInquirerPrompts(): Prompts`. Prompts render on **stderr**: pass the output stream through `@inquirer/prompts`' context argument, and verify the option name in the installed version's README before using it.
- Produces (`context.ts`): `interface CliDeps { io: Io; prompts: Prompts; fetch: typeof fetch; spawner: Spawner; runChild: RunChild; selectStore?: () => Promise<CredentialStore> }`. `Spawner` and `RunChild` are declared as types here and implemented in Tasks 4 and 8. The interface `CommandContext { deps: CliDeps; out: Output; flags: GlobalFlags }` is extended in Task 3 with `config`.
- Produces (`program.ts`): `buildProgram(deps: CliDeps): Command`. Global options:
  - `--json`, `-q/--quiet`, `--no-color`, `--debug`, `--api-url <url>`, `--project <slug>`, `--env <slug>`, `--path <path>`, `-y/--yes`, `--version`.
  - `program.exitOverride()` with `configureOutput({ writeOut: io.stdout.write, writeErr: io.stderr.write })`.
  - `configureHelp({ helpWidth: 100 })` for deterministic help.

  Verify these Commander APIs (`exitOverride`, `configureOutput`, `configureHelp`, `enablePositionalOptions`, `passThroughOptions`) against the README of the installed major version.
- Produces (`main.ts`): `main(argv: string[], deps?: Partial<CliDeps>): Promise<number>`. It maps a Commander usage error to `2` (and `--help`/`--version` to `0`), a `CliError` to its `exitCode`, and anything else to `1` with "error: Unexpected error (run with --debug for details)". Under `--debug` only, it prints the error name and stack. The bin entry is `process.exitCode = await main(process.argv)`.
- Produces (`test/support/io.ts`, re-exported by `test/support/index.ts` and imported as `#test/support`; `fakes.ts` and `fs.ts` hold `fakeApi`, `fakePrompts`, `fakeSpawner` and `tmpDir`): `createTestIo(opts?: { stdin?: string; stdinIsTTY?: boolean; stdoutIsTTY?: boolean; env?: Record<string, string>; cwd?: string; platform?: NodeJS.Platform; homeDir?: string }): Io & { out(): string; err(): string }`, and `runCli(args: string[], deps: Partial<CliDeps> & { io: Io }): Promise<number>`, which calls `main(["node", "anchor", ...args], deps)`.

- [ ] **Step 1: Scaffold the package.**
  - Dependencies: `commander`, `@inquirer/prompts`, `@anchor/shared` (`workspace:*`).
  - devDependencies: `vitest`, `tsx`, `esbuild`, `@types/node`, `dotenv`, `yaml` (the last two are for round-trip tests only).
  - Scripts: `dev` (`tsx src/main.ts`), `test` (`vitest run`, all layers except e2e), `test:unit` (`vitest run test/unit`), `test:integration` (`vitest run test/integration`), `test:e2e` (`vitest run -c vitest.e2e.config.ts`), `typecheck` (`tsc --noEmit`), `build` (`node build.mjs`).
  - `imports` map in `package.json`: `"#src/*": "./src/*.ts"` and `"#test/support": "./test/support/index.ts"`. Tests import source as `#src/...` and helpers from `#test/support`.
  - `vitest.config.ts`: `test.include` is `["test/**/*.test.ts"]` and `test.exclude` contains `"test/e2e/**"` (plus `node_modules`), so the e2e suite only runs through `test:e2e`.
  - `CLI_VERSION` in `src/version.ts` is replaced at build time by esbuild/Bun `define` and falls back to reading `package.json` in dev.
- [ ] **Step 2: Write the failing tests.**
  - `test/unit/output.test.ts`:
    - `json mode writes exactly one JSON document to stdout and nothing else`
    - `info is suppressed by --quiet and by --json, warn is not`
    - `shouldUseColor is false when NO_COLOR is set, TERM=dumb, stream not a TTY, or --no-color`
    - `error prints message and hint on stderr only`
  - `test/integration/main.test.ts` (runs `main` through `runCli`):
    - `--version prints the version on stdout and exits 0`
    - `unknown command exits 2 with the usage error on stderr and empty stdout`
    - `unexpected exception exits 1 without a stack trace unless --debug`
- [ ] **Step 3: Run the tests and confirm they fail.** Run `pnpm --filter ./apps/cli test`. Expected: FAIL.
- [ ] **Step 4: Implement the files above.**
- [ ] **Step 5: Run the tests and confirm they pass.** Run `pnpm --filter ./apps/cli test && pnpm typecheck`.
- [ ] **Step 6: Commit** with `git commit -m "feat(cli): scaffold package, output layer and exit codes"`.

---

### Task 2: API client

**Files:**
- Create: `apps/cli/src/api/{client,http,proxy}.ts`
- Test: `apps/cli/test/unit/api/client.test.ts` (covers `http.ts`, `client.ts` and the `errors.ts` additions; all I/O is the injected fake `fetch`)

**Interfaces:**
- Produces (`http.ts`):
  - `class ApiRequestError extends Error { constructor(readonly status: number, readonly code: ErrorCode | "network_error" | "timeout", message: string) }`. Status is `0` for network errors and timeouts.
  - `interface HttpOptions { baseUrl: string; token?: string; fetch: typeof fetch; timeoutMs?: number /* 15000 */; maxRetries?: number /* 2 */; sleep?: (ms: number) => Promise<void>; debug?: (line: string) => void; userAgent: string }`.
  - `request<T>(opts: HttpOptions, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<{ status: number; data: T }>`.
  - Behavior:
    - It sets `Authorization: Bearer <token>`, `Accept` and `Content-Type: application/json`, and uses `AbortSignal.timeout`.
    - A non-2xx response with an `ApiErrorBody` throws `ApiRequestError(status, body.error.code, body.error.message)`. A non-JSON error body throws `(status, "internal", "Unexpected response from server (HTTP <status>)")`.
    - Retry policy as in Global Constraints.
    - Network error messages: `ECONNREFUSED` → "Could not connect to <origin>". `ENOTFOUND` → "Could not resolve host <host>". A cause code starting with `CERT_`, or equal to `UNABLE_TO_VERIFY_LEAF_SIGNATURE` or `DEPTH_ZERO_SELF_SIGNED_CERT` → "TLS certificate verification failed for <origin>". A timeout → "Request to <origin> timed out after 15s".
    - Debug line exactly: `debug: <METHOD> <path> -> <status> (<ms>ms)`. It is built only from the method, the path (without the query string) and the status. Headers and bodies are never logged.
- Produces (`client.ts`): `createApiClient(opts: HttpOptions): ApiClient` with:
  - `login(email: string, password: string): Promise<LoginResponse>`, which sends `client: "cli"`
  - `logout(): Promise<void>`
  - `me(): Promise<{ user?: UserDto; serviceToken?: ServiceTokenDto }>`
  - `listProjects(): Promise<ProjectDto[]>`, `getProject(slug: string): Promise<ProjectDto>`
  - `listEnvironments(project: string): Promise<EnvironmentDto[]>`
  - `listSecrets(project, env, q: { path: string; reveal: boolean }): Promise<SecretDto[]>`
  - `getSecret(project, env, key, q: { path: string }): Promise<SecretDto>`
  - `putSecret(project, env, key, body: { value: string; comment?: string; path: string }): Promise<{ secret: SecretDto; created: boolean }>`, where `created` is `status === 201`
  - `deleteSecret(project, env, key, q: { path: string }): Promise<void>`
  - `listServiceTokens(project): Promise<ServiceTokenDto[]>`
  - `createServiceToken(project, body: { name: string; permission: "read" | "read-write"; scopes: { environment: string; path: string }[]; expiresInDays: number }): Promise<{ serviceToken: ServiceTokenDto; token: string }>`
  - `revokeServiceToken(project, id): Promise<void>`

  All path segments go through `encodeURIComponent`.
- Produces (`errors.ts`, extended): `exitCodeForApiError(e: ApiRequestError): number`:
  - `unauthenticated` and `invalid_credentials` → 3
  - `forbidden` → 4
  - `not_found` → 5
  - `conflict` → 6
  - everything else → 1

  Also add `toCliError(e: unknown, ctx: { apiUrl: string; authSource?: "ANCHOR_TOKEN" | "stored" }): CliError`:
  - For `unauthenticated` with a stored session: hint "Run 'anchor login'" and message "Your session has expired or was revoked".
  - For `unauthenticated` with `ANCHOR_TOKEN`: message "ANCHOR_TOKEN was rejected (expired, revoked or invalid)".
- Produces (`proxy.ts`): `configureProxyFromEnv(env): void`. When `HTTPS_PROXY`/`HTTP_PROXY` is set and the runtime is Node, make the global `fetch` honor it. **Verify the mechanism for the Node version in CI**: prefer Node's built-in env-proxy support if the installed Node documents it (`NODE_USE_ENV_PROXY`); otherwise use undici's `EnvHttpProxyAgent` with `setGlobalDispatcher`, adding `undici` as a dependency. Under Bun, do nothing (Bun's fetch reads proxy env vars itself; confirm in the Bun docs). There is no unit test for proxying beyond "does not throw when unset". Document the proxy behavior in `docs/cli.md`.

- [ ] **Step 1: Write the failing tests** with a fake `fetch`:
  - `sends bearer token, JSON headers and user agent`
  - `maps error body to ApiRequestError with server code and message`
  - `retries GET on 503 twice then succeeds; never retries POST or DELETE` (count calls)
  - `retries PUT on network error`
  - `does not retry on 4xx`
  - `times out with code timeout` (fake fetch that honors the abort signal; `timeoutMs: 10`)
  - `maps ECONNREFUSED / ENOTFOUND / CERT_HAS_EXPIRED causes to the documented messages`
  - `debug line has method, path without query, status and duration only`. Call `listSecrets(..., { reveal: true })` with a token `anc_s_TOKENCANARY` and a response containing value `VALUECANARY`, then assert that neither canary appears in any debug line.
  - `putSecret reports created from 201 vs 200`
  - `exitCodeForApiError maps every ErrorCode` (table over `ERROR_CODES`)
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(cli): typed API client with timeouts and retries"`.

---

### Task 3: Configuration, project file, user config

**Files:**
- Create: `apps/cli/src/config/{api-url,project-file,user-config,resolve}.ts`
- Modify: `apps/cli/src/context.ts`
- Test: `apps/cli/test/unit/config/api-url.test.ts` (the `normalizeApiUrl` case, pure), `apps/cli/test/integration/config/config.test.ts` (all other cases; they use temp dirs)

**Interfaces:**
- Produces (`api-url.ts`): `normalizeApiUrl(input: string): string`. It returns the origin and throws `CliError(EXIT.USAGE, "Invalid API URL: <input>")` for an unparsable URL. For `http:` on a host other than `localhost`/`127.0.0.1`/`[::1]` it throws `CliError(EXIT.USAGE, "Refusing to use insecure http:// API URL <origin>", "Use https://")`.
- Produces (`project-file.ts`):
  - `PROJECT_FILE = ".anchor.json"`
  - `projectFileSchema = z.strictObject({ version: z.literal(1), project: slugSchema, defaultEnv: slugSchema.optional(), path: secretPathSchema.optional(), apiUrl: z.string().optional() })`
  - `type ProjectFile`
  - `findProjectFile(cwd: string): Promise<string | null>`: walks up to the filesystem root and returns the first `.anchor.json` path.
  - `readProjectFile(path): Promise<ProjectFile>`. Invalid JSON or a schema failure throws `CliError(EXIT.ERROR, "<path> is invalid: <field paths>")`. If **any string value** in the raw JSON starts with `anc_`, it throws `CliError(EXIT.ERROR, "<path> contains a token. Tokens must never be stored in .anchor.json", "Remove it and rotate the token")`. That message never includes the value.
  - `writeProjectFile(dir: string, pf: ProjectFile): Promise<string>`: 2-space JSON plus a newline, mode 0644.
- Produces (`user-config.ts`): `userConfigDir(io: Io): string`, `readUserConfig(io): Promise<{ apiUrl?: string }>` (a missing file → `{}`), `writeUserConfig(io, cfg)` (dir 0700, file 0600).
- Produces (`resolve.ts`):
  - `type Source = "flag" | "env" | "project" | "user" | "default"`
  - `interface ResolvedConfig { apiUrl: { value: string; source: Source } | null; project: { value: string; source: Source } | null; env: { value: string; source: Source }; path: { value: string; source: Source }; projectFilePath: string | null; userApiUrl: string | null }`
  - `resolveConfig(io: Io, flags: GlobalFlags): Promise<ResolvedConfig>`: applies the precedence and normalizes `apiUrl` with `normalizeApiUrl` and `path` with `normalizeSecretPath`.
- Produces (`context.ts`): `CommandContext.config: ResolvedConfig` and `requireProject(ctx): string`, which throws `CliError(EXIT.USAGE, "No project selected", "Run 'anchor init' or pass --project <slug>")`.

- [ ] **Step 1: Write the failing tests** (tmp dirs, `createTestIo`; the `normalizeApiUrl` case goes in the unit file, the rest in the integration file):
  - `flag beats env beats project file beats user config beats default` (table over apiUrl, project, env, path, asserting value and source)
  - `finds .anchor.json in a parent directory`
  - `env defaults to dev and path to /`
  - `project file with unknown key is rejected naming the key`
  - `project file containing an anc_ token is rejected and the message does not contain the token` (Review Focus 3)
  - `normalizeApiUrl strips path and trailing slash; rejects http://example.com; allows http://localhost:8787`
  - `user config is written with mode 0600 in XDG_CONFIG_HOME/anchor` (POSIX only)
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(cli): config precedence and .anchor.json project file"`.

---

### Task 4: Credential stores

**Files:**
- Create: `apps/cli/src/credentials/{types,macos,linux,file,select}.ts`, `apps/cli/src/process/spawner.ts`
- Test: `apps/cli/test/unit/credentials/{types,macos,linux,select}.test.ts` (fake spawner only), `apps/cli/test/integration/credentials/file.test.ts` (real temp dirs)

**Interfaces:**
- Produces (`types.ts`):
  - `StoredCredential = { apiUrl: string; token: string; email: string; expiresAt: number }`
  - `interface CredentialStore { readonly kind: "macos-keychain" | "secret-service" | "file"; get(apiUrl: string): Promise<StoredCredential | null>; set(c: StoredCredential): Promise<void>; delete(apiUrl: string): Promise<void> }`
  - `type Spawner = (cmd: string, args: string[], opts?: { input?: string }) => Promise<{ code: number; stdout: string; stderr: string }>`. It rejects with `code: "ENOENT"` when the binary is missing.
  - `SERVICE_NAME = "anchor-cli"`
  - `encodeCredential(c): string` (base64url of JSON; the output contains only `[A-Za-z0-9_-]`)
  - `decodeCredential(s): StoredCredential | null` (validated with zod; `null` on garbage)
- Produces (`process/spawner.ts`): `createNodeSpawner(): Spawner`, using `child_process.spawn` with `shell: false`. `input` is written to stdin and then ended.
- Produces (`macos.ts`): `createMacosKeychainStore(spawner): CredentialStore`. The account is the API origin.
  - `get`: `security find-generic-password -s anchor-cli -a <origin> -w`. Exit 0 → decode stdout (trimmed). "Item not found" (verify the exit code, expected 44) → `null`. Anything else → `CliError(EXIT.ERROR, "Could not read the macOS keychain: <first stderr line>")`.
  - `set`: `spawner("security", ["-i"], { input: 'add-generic-password -U -s anchor-cli -a "<origin>" -w "<encoded>"\n' })`, so the token is only in stdin. **Verify on macOS** that `security -i` executes commands from piped stdin and exits at EOF, and how it reports errors (exit code vs stderr text). Treat any stderr output containing `error` as failure.
  - `delete`: `security delete-generic-password -s anchor-cli -a <origin>`. "Not found" is ok.
- Produces (`linux.ts`): `createSecretServiceStore(spawner): CredentialStore`.
  - `get`: `secret-tool lookup service anchor-cli account <origin>`. Exit 1 with empty output → `null`.
  - `set`: `secret-tool store --label "Anchor CLI (<origin>)" service anchor-cli account <origin>` with the encoded credential on stdin (no trailing newline).
  - `delete`: `secret-tool clear service anchor-cli account <origin>`.
- Produces (`file.ts`): `createFileStore(path: string, out: Output): CredentialStore`.
  - The file is JSON `{ version: 1, credentials: Record<origin, StoredCredential> }`.
  - Writes go to a temp file opened with mode 0600 in the same dir and are then renamed. The dir is created with 0700.
  - On `get` (POSIX), if `(stat.mode & 0o077) !== 0`, it throws `CliError(EXIT.ERROR, "<path> is accessible by other users", "Run 'chmod 600 <path>'")`.
  - The first `set` in a process warns: `No OS keychain available; credentials stored in <path> (mode 0600)`.
- Produces (`select.ts`): `selectCredentialStore(io: Io, deps: { spawner: Spawner; out: Output }): Promise<CredentialStore>`.
  - `ANCHOR_CREDENTIAL_STORE=file` → file store at `<userConfigDir>/credentials.json`.
  - `darwin` → keychain (if `security` spawns; ENOENT → file).
  - `linux` → secret-service when `DBUS_SESSION_BUS_ADDRESS` is set and `secret-tool` exists (probe with `secret-tool --version`; verify that the flag exists, else use `which secret-tool`).
  - Otherwise, including `win32` → file.
  - If a keychain `set` fails, fall back to the file store with a warning.

- [ ] **Step 1: Write the failing tests** with `fakeSpawner()`, which records `{ cmd, args, input }` and returns scripted results. File placement: macOS cases in `unit/credentials/macos.test.ts`, Linux cases in `unit/credentials/linux.test.ts`, the `decodeCredential` case in `unit/credentials/types.test.ts`, the `selectCredentialStore` case in `unit/credentials/select.test.ts`, and the three file-store cases in `integration/credentials/file.test.ts`:
  - `macOS set passes the token only via stdin`: assert `JSON.stringify(call.args)` does not contain the token or the encoded credential, and `call.input` contains the encoded credential (Review Focus 1)
  - `macOS get decodes stdout; not-found returns null; other failure throws CliError without the token`
  - `linux set passes the token only via stdin` (same assertion), and `lookup exit 1 returns null`
  - `file store round-trips, writes mode 0600, dir 0700` (POSIX)
  - `file store refuses to read a 0644 credentials file` (POSIX)
  - `file store keeps credentials for two origins independently; delete removes one`
  - `decodeCredential returns null for garbage and for a JSON missing token`
  - `selectCredentialStore honors ANCHOR_CREDENTIAL_STORE=file; picks file on win32; falls back to file when security is missing`
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.** On a macOS dev machine, also run the opt-in real-keychain test `ANCHOR_TEST_KEYCHAIN=1 pnpm --filter ./apps/cli test:integration macos-real` (create `test/integration/credentials/macos-real.test.ts`: set/get/delete against the real `security` binary with a throwaway origin `https://anchor-test.invalid`; skipped unless the env var is set). Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(cli): OS keychain and 0600 file credential stores"`.

---

### Task 5: Auth resolution, `login`, `logout`, `whoami`

**Files:**
- Create: `apps/cli/src/auth.ts`, `apps/cli/src/commands/{login,logout,whoami}.ts`
- Modify: `apps/cli/src/program.ts`
- Test: `apps/cli/test/unit/auth.test.ts` (`resolveAuth` cases), `apps/cli/test/integration/commands/login.test.ts` (`login`, `logout` and `whoami` cases, run through `runCli`)

**Interfaces:**
- Produces (`auth.ts`):
  - `resolveAuth(ctx: CommandContext, store: CredentialStore): Promise<{ apiUrl: string; token: string; source: "ANCHOR_TOKEN" | "stored" }>`. Rules, in order:
    1. No API URL resolved → `CliError(EXIT.USAGE, "No API URL configured", "Run 'anchor login --api-url https://...' or set ANCHOR_API_URL")`.
    2. `ANCHOR_TOKEN` set and `config.apiUrl.source === "project"` → `CliError(EXIT.USAGE, "ANCHOR_TOKEN is only sent to an API URL from --api-url, ANCHOR_API_URL or your user config", "Set ANCHOR_API_URL")` (Review Focus 3).
    3. `ANCHOR_TOKEN` set → use it.
    4. Stored credential for the origin → use it. If `expiresAt <= Date.now()`, throw `CliError(EXIT.AUTH, "Your session has expired", "Run 'anchor login'")`.
    5. Otherwise → `CliError(EXIT.AUTH, "Not logged in to <origin>", "Run 'anchor login' or set ANCHOR_TOKEN")`.
  - `authedApi(ctx): Promise<{ api: ApiClient; auth: { apiUrl: string; source: "ANCHOR_TOKEN" | "stored" } }>`. Every command except `login` gets its client here. Callers wrap API errors with `toCliError`.
- Produces (commands):
  - `login(ctx, opts: { email?: string; passwordStdin: boolean }): Promise<void>`. Flags: `--email <email>`, `--password-stdin`, plus the global `--api-url`.
    1. Resolve the API URL from config. If none: in a TTY, prompt "API URL"; otherwise exit 2. Then normalize; an insecure URL exits 2 **before** any password is read.
    2. If `config.apiUrl.source === "project"` and `config.userApiUrl` differs, warn: `.anchor.json points to <origin>, which differs from your configured <userOrigin>`.
    3. Always print `Logging in to <origin>` to stderr.
    4. Email comes from the flag, or a prompt in a TTY; otherwise exit 2.
    5. Password comes from `--password-stdin` (read all stdin, strip one trailing `\n` or `\r\n`). Otherwise use a TTY hidden prompt. Otherwise exit 2 with `CliError(EXIT.USAGE, "anchor login needs a terminal", "Use --password-stdin, or set ANCHOR_TOKEN in CI")`.
    6. Call `api.login`. Map `invalid_credentials` → exit 3 "Invalid email or password". Map `rate_limited` → exit 1 "Too many failed attempts; try again later".
    7. `store.set({ apiUrl, token, email: user.email, expiresAt })`. If the user config has no `apiUrl`, write it.
    8. Output: human `Logged in to <origin> as <email>`. `--json` → `{ apiUrl, user, expiresAt, credentialStore: store.kind }`. The token is never printed.
  - `logout(ctx): Promise<void>`.
    - With `ANCHOR_TOKEN` set: warn "ANCHOR_TOKEN is set; logout only affects stored credentials" and continue with the stored credential.
    - No stored credential → info "Not logged in", exit 0.
    - Otherwise call `api.logout()` with the stored token. A 401 counts as already revoked. Then `store.delete(origin)`.
    - If the server call failed for another reason, still delete locally, then exit 1 with `CliError(EXIT.ERROR, "Removed local credentials but could not revoke the session on the server", "It stays valid until <ISO expiresAt>")`.
    - `--json` → `{ loggedOut: true, revoked: boolean }`.
  - `whoami(ctx): Promise<void>`: human output is `<email> (<role>) at <origin>` or `service token <name> (<permission>) for project <projectSlug> at <origin>`. `--json` → `{ apiUrl, type: "user", user }` or `{ apiUrl, type: "service_token", serviceToken }`.

- [ ] **Step 1: Write the failing tests** with `fakeApi()` (a scripted `ApiClient`), `fakePrompts()` and an in-memory `CredentialStore`:
  - `resolveAuth prefers ANCHOR_TOKEN over stored credential`
  - `resolveAuth refuses ANCHOR_TOKEN when the API URL came only from .anchor.json` (Review Focus 3)
  - `resolveAuth: no credential -> exit 3 with login hint; expired stored session -> exit 3`
  - `login --password-stdin stores credential and prints no token on stdout or stderr`
  - `login without TTY and without --password-stdin exits 2 and never calls the API` (Review Focus 5)
  - `login to http://example.com exits 2 before prompting for a password` (assert the password prompt was not called; Review Focus 5)
  - `login warns when .anchor.json apiUrl differs from user config and always names the target origin`
  - `login invalid credentials -> exit 3 'Invalid email or password'`
  - `logout revokes server-side then deletes locally; network failure still deletes locally and exits 1`
  - `whoami renders user and service-token principals; --json shapes match the contract`
  - `revoked session on whoami -> exit 3 'Your session has expired or was revoked' with login hint` (fake API returns 401)
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement, and register the commands** in `buildProgram`, each with a description and an example in `addHelpText("after", ...)`.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(cli): login, logout, whoami and auth resolution"`.

---

### Task 6: `init`, `projects list`, `envs list`

**Files:**
- Create: `apps/cli/src/commands/{init,projects,envs}.ts`
- Modify: `apps/cli/src/program.ts`
- Test: `apps/cli/test/integration/commands/init.test.ts`, `apps/cli/test/integration/commands/discovery.test.ts` (`projects list` and `envs list`)

**Interfaces:**
- Produces:
  - `projectsList(ctx)`: human table `SLUG  NAME  CREATED`; `--json` → `{ projects: ProjectDto[] }`.
  - `envsList(ctx)`: requires a project; human table `SLUG  NAME`; `--json` → `{ environments: EnvironmentDto[] }`.
  - `init(ctx, opts: { yes: boolean })`:
    1. The project comes from `--project`, else a TTY `select` over `listProjects()`, else exit 2 "Pass --project in non-interactive mode".
    2. Verify it with `getProject` (404 → exit 5 "Project <slug> not found").
    3. The default env comes from `--env`, else a TTY select over `listEnvironments`, else `dev` if it exists, else the first env.
    4. Write `.anchor.json` in `ctx.deps.io.cwd` as `{ version: 1, project, defaultEnv }`, plus `apiUrl` only when it came from a flag. If the file already exists: a TTY `confirm("Overwrite .anchor.json?")`; non-TTY without `--yes` → exit 2.
    5. Output: human `Linked <cwd> to <project> (default env <env>)`; `--json` → `{ projectFile, project, defaultEnv }`.

- [ ] **Step 1: Write the failing tests:**
  - `init non-interactive with --project and --env writes the documented file`
  - `init without --project in non-TTY exits 2`
  - `init with unknown project exits 5 and writes nothing`
  - `init refuses to overwrite in non-TTY without --yes; overwrites with --yes`
  - `init interactive selects project and env via prompts`
  - `projects list and envs list human + --json output`
  - `envs list without a project exits 2 with the init hint`
  - `403 from the API maps to exit 4`
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement and register the commands.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(cli): init, projects list, envs list"`.

---

### Task 7: `secrets list | get | set | delete`

**Files:**
- Create: `apps/cli/src/commands/secrets.ts`, `apps/cli/src/secret-input.ts`, `apps/cli/src/confirm.ts`
- Modify: `apps/cli/src/program.ts`, `apps/cli/src/main.ts` (call `assertNoSecretInArgv` before parsing)
- Test: `apps/cli/test/integration/commands/secrets.test.ts`, `apps/cli/test/unit/secret-input.test.ts`

**Interfaces:**
- Produces (`secret-input.ts`):
  - `assertNoSecretInArgv(argv: string[]): void` throws `CliError(EXIT.USAGE, "Secret values are not accepted as command-line arguments", "Pipe the value on stdin or use --from-file <path>")` when:
    - any arg is `--value` or starts with `--value=`, or
    - the args contain `secrets set` and the next positional contains `=`.

    The message never includes the arg.
  - `readSecretValue(ctx, key: string, opts: { fromFile?: string }): Promise<string>`:
    - `--from-file` → exact file contents as UTF-8, no trimming.
    - Else stdin not a TTY → all stdin with exactly one trailing `\n` or `\r\n` stripped.
    - Else hidden prompt `Value for <key>`.

    Size and validity are checked with `secretValueSchema` before any request. Too large → `CliError(EXIT.USAGE, "Value for <key> exceeds 65536 bytes")`.
- Produces (`confirm.ts`): `confirmDestructive(ctx, message: string): Promise<void>`.
  - `--yes` → returns.
  - stdin and stderr are TTYs → `prompts.confirm({ message, default: false })`. A "no" → `CliError(EXIT.ERROR, "Aborted")`.
  - Otherwise → `CliError(EXIT.USAGE, "Refusing to continue without --yes in non-interactive mode")`.
- Produces (commands; the scope is project/env/path from config, and `KEY` is validated with `secretKeySchema`, exit 2 on failure):
  - `secretsList(ctx, opts: { reveal: boolean })`: human table `KEY  VERSION  UPDATED  COMMENT`, plus `VALUE` with `--reveal`. `--json` → `{ secrets: SecretDto[] }`, which carries values only with `--reveal`.
  - `secretsGet(ctx, key, opts: { reveal: boolean })`:
    - The value is shown only if `--reveal` **or** stdout is not a TTY.
    - Piped and not `--json`: `out.raw(value)` exactly, with no added newline.
    - TTY without `--reveal`: human metadata with the value shown as `********`, plus stderr hint "Use --reveal to show the value".
    - `--json` → `{ secret }`, with `value` only under the same rule.
  - `secretsSet(ctx, key, opts: { fromFile?: string; comment?: string })`: human output `Created <KEY> (v<n>) in <env>:<path>`, `Updated <KEY> (v<n>) ...`, or `Unchanged <KEY> (v<n>)` (when the returned version equals the previous one and was not created). `--json` → `{ secret, created }`. The value is never echoed.
  - `secretsDelete(ctx, key, opts: { yes: boolean })`: `confirmDestructive(ctx, "Delete <KEY> from <project>/<env>:<path>?")`, then delete. `--json` → `{ deleted: { key, environment, path } }`.

- [ ] **Step 1: Write the failing tests:**
  - `assertNoSecretInArgv rejects --value, --value=x and 'secrets set KEY=hunter2' without echoing hunter2` (Review Focus 1)
  - `set reads stdin and strips exactly one trailing newline`. `"a\n\n"` → `"a\n"`.
  - `set --from-file keeps exact bytes including trailing newline`
  - `set prompts hidden in TTY`
  - `set rejects 65537-byte value before calling the API`
  - `set never writes the value to stdout or stderr` (canary)
  - `set reports Created/Updated/Unchanged`
  - `get in TTY masks without --reveal; piped prints raw value with no added newline; --json follows the same rule`
  - `list --json has values only with --reveal`
  - `delete in non-TTY without --yes exits 2 and does not call the API` (Review Focus 5)
  - `delete with --yes calls the API`
  - `invalid key '1BAD' exits 2`
  - `API 404 -> exit 5, 403 -> exit 4, 409 -> exit 6`
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement and register `anchor secrets <list|get|set|delete>`** with flags `--reveal`, `--from-file <path>`, `--comment <text>`.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(cli): secrets list/get/set/delete"`.

---

### Task 8: `anchor run`

**Files:**
- Create: `apps/cli/src/process/run-child.ts`, `apps/cli/src/commands/run.ts`
- Modify: `apps/cli/src/program.ts`
- Test: `apps/cli/test/integration/commands/run.test.ts`, `apps/cli/test/integration/process/run-child.test.ts`, `apps/cli/test/support/fixtures/child.mjs`

**Interfaces:**
- Produces (`run-child.ts`):
  - `type RunChild = (cmd: string, args: string[], env: Record<string, string>) => Promise<{ code: number | null; signal: NodeJS.Signals | null }>`
  - `createNodeRunChild(proc: Pick<NodeJS.Process, "on" | "off"> = process): RunChild`:
    - It runs `spawn(cmd, args, { stdio: "inherit", env, shell: false })`.
    - While the child runs, `SIGINT`, `SIGTERM` and `SIGHUP` on `proc` are forwarded with `child.kill(signal)`. The parent does not exit on them, and the listeners are removed after exit.
    - `ENOENT` → rejects with `CliError(127, "Command not found: <cmd>")`.
  - `exitCodeFromChild(r): number` → `r.code ?? 128 + os.constants.signals[r.signal!]`.
- Produces (`run.ts`):
  - `buildChildEnv(parent: Record<string, string | undefined>, secrets: SecretDto[], override: boolean): Record<string, string>`. With `override` (the default), Anchor values replace existing variables. With `--no-override`, existing variables win. Undefined parent entries are dropped.
  - `runCommand(ctx, argv: string[], opts: { override: boolean }): Promise<number>`:
    - An empty argv → `CliError(EXIT.USAGE, "Missing command", "Usage: anchor run [options] -- <command> [args...]")`.
    - It fetches `listSecrets(project, env, { path, reveal: true })`. **Any error is thrown before spawning**.
    - It spawns the child and returns `exitCodeFromChild`.
    - Debug output says only `debug: injecting <n> secrets into <cmd>`.
  - Command registration: `anchor run [--no-override] -- <command...>` with `.passThroughOptions()` on `run` and `.enablePositionalOptions()` on the program, so flags after `--` reach the child. Verify this Commander behavior in its README. `main()` returns the child's code instead of `0`.

- [ ] **Step 1: Write the failing tests:**
  - `buildChildEnv`: override true replaces `FOO`; `--no-override` keeps the parent `FOO`; new keys are always added
  - `fetch failure never spawns`: fake API network error, 401 and 403 → `runChild` not called; exit codes 1/3/4 (Review Focus 2)
  - `missing command after -- exits 2`
  - `flags after -- are passed to the child verbatim` (`anchor run -- node --version`)
  - `secret values are not printed on stdout/stderr even with --debug` (canary)
  - `integration/process/run-child.test.ts` (real processes, POSIX only). The fixture `support/fixtures/child.mjs` prints `ready` and on SIGTERM writes `got SIGTERM` and exits 42; with arg `exit:N` it exits N; with arg `env:KEY` it prints `process.env[KEY]`.
    - `propagates child exit code 3`
    - `emitting SIGTERM on the fake proc forwards to the child and resolves with 42`
    - `child killed by SIGKILL -> exitCodeFromChild 137`
    - `nonexistent command -> CliError 127`
    - `child sees injected env`
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(cli): anchor run with env injection and signal forwarding"`.

---

### Task 9: `anchor export`

**Files:**
- Create: `apps/cli/src/format/env-file.ts`, `apps/cli/src/files.ts`, `apps/cli/src/commands/export.ts`
- Modify: `apps/cli/src/program.ts`
- Test: `apps/cli/test/unit/format/env-file.test.ts`, `apps/cli/test/integration/commands/export.test.ts`

**Interfaces:**
- Produces (`env-file.ts`, input `entries: [key: string, value: string][]` sorted by key):
  - `formatDotenv(entries): string` — one `KEY=...` line per entry, with quoting chosen by this algorithm (the target is round-trip compatibility with the `dotenv` npm parser):
    1. The value matches `/^[A-Za-z0-9_.\/:@+,-]*$/` → bare `KEY=value`.
    2. Else, the value has no newline and no `'` → `KEY='value'`.
    3. Else, the value has no `"`, and no `\` adjacent to `n` or `r` → `KEY="value"`, with `\n` and `\r` written as escapes.
    4. Else, the value has no newline and no backtick → ``KEY=`value` ``.
    5. Else → throw `CliError(EXIT.ERROR, "Value of <KEY> cannot be represented in dotenv format", "Use --format json or --format yaml")`.
  - `formatJson(entries): string`: an object with sorted keys, 2-space indent, trailing newline.
  - `formatYaml(entries): string`: `KEY: <JSON.stringify(value)>` per line. JSON strings are valid YAML double-quoted scalars.
- Produces (`files.ts`):
  - `writeSecretFile(path: string, content: string): Promise<void>`: writes a temp file in the same dir opened with mode 0600, renames it over the target, then `chmod(path, 0o600)`.
  - `isGitIgnored(path: string, spawner: Spawner): Promise<boolean | null>`: runs `git -C <dirname> check-ignore -q -- <basename>`. Exit 0 → true, exit 1 → false, ENOENT or anything else (not a repo) → null.
- Produces (`export.ts`): `exportCommand(ctx, opts: { format: "dotenv" | "json" | "yaml"; output?: string; yes: boolean })`:
  - Without `--output`: if stdout is a TTY → `CliError(EXIT.USAGE, "Refusing to print secrets to a terminal", "Use --output <file> or pipe the output")`. Otherwise `out.raw(content)`. `--json` without `--output` → exit 2 "Use --format json instead of --json".
  - With `--output`: if the file exists, `confirmDestructive("Overwrite <file>?")`. Then `writeSecretFile`. When `isGitIgnored` returns `false`, warn `<file> is not gitignored; add it to .gitignore`. Human output: `Wrote <n> secrets to <file>`. `--json` → `{ path, count, format }`.

- [ ] **Step 1: Write the failing tests:**
  - `unit/format/env-file.test.ts`: round-trip through `dotenv.parse` for each of: `plain`, `with space`, `has#hash`, `a=b`, a 3-line PEM, `say "hi"`, `it's`, `both ' and "`, the empty string, `🔑 ünïcødé`, and `C:\path\name` (a backslash followed by `n`). For each value, `parse(formatDotenv([["K", v]])).K === v`.
    - A value with both `"` and a newline throws the documented `CliError` (Review Focus 4).
    - JSON and YAML round-trip through `JSON.parse` and `yaml.parse` for the same set.
  - `integration/commands/export.test.ts` (tmp git repo created with `git init`):
    - `refuses TTY stdout without --output`
    - `pipes dotenv to non-TTY stdout`
    - `--output creates the file with mode 0600`
    - `--output over an existing 0644 file leaves it 0600 after confirmation with --yes` (Review Focus 4)
    - `non-TTY overwrite without --yes exits 2 and leaves the file untouched`
    - `warns when the output file is not gitignored and not when it is`
    - `no warning outside a git repo`
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement and register** `anchor export [--format <dotenv|json|yaml>] [--output <file>]` (default format `dotenv`).
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(cli): export secrets to dotenv/json/yaml"`.

---

### Task 10: `tokens create | list | revoke`

**Files:**
- Create: `apps/cli/src/commands/tokens.ts`
- Modify: `apps/cli/src/program.ts`
- Test: `apps/cli/test/integration/commands/tokens.test.ts`

**Interfaces:**
- Produces:
  - `parseScope(input: string): { environment: string; path: string }`. `prod` → `{ environment: "prod", path: "/" }`. `prod:/api` → `{ "prod", "/api" }`. The env is validated by `slugSchema` and the path by `normalizeSecretPath`. Invalid input → `CliError(EXIT.USAGE, "Invalid scope '<input>'", "Use <env> or <env>:<path>")`.
  - `tokensCreate(ctx, opts: { name: string; scope: string[]; permission: "read" | "read-write"; expiresIn: number })`. Flags: `--name <name>` (required), `--scope <env[:path]>` (repeatable, default `[config.env]`), `--permission <read|read-write>` (default `read`), `--expires-in <days>` (default `90`, integer 1–365, else exit 2).
    - Human output: the token alone on stdout, plus stderr lines `Created service token <name> (<permission>), expires <ISO date>` and `Store this token now; it will not be shown again.`
    - `--json` → `{ serviceToken, token }`.
  - `tokensList(ctx)`: human table `ID  NAME  PREFIX  PERMISSION  SCOPES  EXPIRES  LAST USED  STATUS`. Status is `active`, `expired` or `revoked`. `--json` → `{ serviceTokens }`.
  - `tokensRevoke(ctx, id, opts: { yes: boolean })`: `confirmDestructive("Revoke service token <id>?")`, then call the API. `--json` → `{ revoked: id }`.

- [ ] **Step 1: Write the failing tests:**
  - `parseScope accepts env and env:path; rejects 'Prod', 'prod:/../x', ':/api'`
  - `create sends the documented body with defaults (read, 90 days, current env, path /)`
  - `create prints the token only on stdout and the warning on stderr`
  - `--expires-in 0 and 366 exit 2`
  - `list renders status from revokedAt/expiresAt`
  - `revoke in non-TTY without --yes exits 2 and does not call the API` (Review Focus 5)
  - `403 from create -> exit 4`
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement and register.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(cli): service token commands"`.

---

### Task 11: Help snapshots and CLI reference

**Files:**
- Create: `apps/cli/test/unit/help.test.ts` (snapshots in `apps/cli/test/unit/__snapshots__/help.test.ts.snap`), `docs/cli.md`
- Modify: `apps/cli/src/program.ts` (only to fill gaps the test reveals)

**Interfaces:**
- Consumes: `buildProgram` (Task 1) with every command from Tasks 5–10.

- [ ] **Step 1: Write the failing test.** Walk `program.commands` recursively. For each command, snapshot `helpInformation()` under its full name (e.g. `secrets set`). Also assert that every leaf command's help contains `Example` and that no help text mentions `--token` or `--value`.
- [ ] **Step 2: Run the test.** Expected: FAIL on the example assertion for any command missing it. Add the missing examples.
- [ ] **Step 3: Run the test again to write the snapshots, then re-run.** Expected: PASS. Review the snapshot file by eye for wording.
- [ ] **Step 4: Write `docs/cli.md`**:
  - install (binary from GitHub Releases, or the workspace dev runner)
  - `anchor login` / `init` / `run` walkthrough
  - command reference (one line each, linking to `--help`)
  - global flags
  - config precedence and the `.anchor.json` format
  - env vars, including the `ANCHOR_TOKEN` + `ANCHOR_API_URL` rule
  - credential storage per OS
  - exit codes table
  - `--json` contracts per command (the shapes from Tasks 5–10)
  - proxy support
  - a GitHub Actions example using `ANCHOR_API_URL` and `ANCHOR_TOKEN` (from `anchor tokens create --permission read --scope prod`) with `anchor run -- npm run deploy`
- [ ] **Step 5: Commit** with `git commit -m "docs(cli): help snapshots and CLI reference"`.

---

### Task 12: End-to-end tests against a local Worker

**Files:**
- Create: `apps/cli/vitest.e2e.config.ts` (`test.include: ["test/e2e/**/*.e2e.test.ts"]`), `apps/cli/test/e2e/harness.ts`, `apps/cli/test/e2e/cli.e2e.test.ts`
- Modify: `.github/workflows/ci.yml` (add `pnpm --filter ./apps/cli test:e2e`)

**Interfaces:**
- Produces (`harness.ts`): `startAnchor(): Promise<{ url: string; setupToken: string; stop(): Promise<void> }>`.
  - **Verify the current API first.** Wrangler's docs recommend `createTestHarness` (imported from `wrangler`; `await server.listen()` returns `{ url }`; `await server.close()`), and mark `unstable_dev`/`unstable_startWorker` as deprecated. Check how it accepts secrets/vars and local D1 persistence, and use the first mechanism that works without writing into the repo:
    1. harness options for vars/bindings
    2. a temp env file passed through a supported option (`--env-file` equivalent)
    3. spawning `wrangler dev --port <free port> --persist-to <tmpdir>` with test-only `--var` values
  - Record the choice in a comment at the top of `harness.ts`.
  - Before starting, apply migrations to the same persistence dir with `wrangler d1 migrations apply anchor --local --persist-to <tmpdir>`. The values are a random `ANCHOR_ROOT_KEY` (32 bytes, base64) and a random setup token.
- Produces (`cli.e2e.test.ts`): `cli(args: string[], opts?: { stdin?: string; env?: Record<string, string> }): Promise<{ code: number; stdout: string; stderr: string }>`.
  - It runs `tsx apps/cli/src/main.ts` as a child process with `HOME` and `XDG_CONFIG_HOME` set to a tmp dir, `ANCHOR_CREDENTIAL_STORE=file`, `NO_COLOR=1`, and `ANCHOR_API_URL=<url>`.
  - The child's stdio is pipes, so it is non-TTY.

- [ ] **Step 1: Write the e2e scenario** as one `describe` with ordered steps. It creates the owner via `POST /api/v1/setup` with `fetch`.
  1. `login --email owner@example.com --password-stdin`: exit 0; `credentials.json` has mode 0600; the password does not appear in stdout or stderr.
  2. `whoami --json` → `type: "user"`.
  3. `projects list` is empty. Create project `demo` via `fetch` with the stored token, read from the credentials file through the test helper.
  4. `init --project demo --env dev`: `.anchor.json` written in a tmp cwd.
  5. `secrets set DB_URL` with stdin `postgres://u:p@h/db\n` → `Created`.
  6. `secrets get DB_URL` (piped): stdout is exactly `postgres://u:p@h/db`.
  7. `secrets list --json`: has no `value` field.
  8. `run -- node -e "process.stdout.write(process.env.DB_URL)"` → stdout equals the value, exit 0.
  9. `run -- node -e "process.exit(7)"` → exit 7.
  10. `export --format dotenv --output .env.local --yes`: the file has mode 0600 and parses back.
  11. `tokens create --name ci --scope dev --permission read --json`: capture the token.
  12. Using `ANCHOR_TOKEN=<token>`: `secrets get DB_URL` exits 0. `secrets set X` with stdin `y` exits 4.
  13. Using `ANCHOR_TOKEN` with the API URL only in `.anchor.json` (unset `ANCHOR_API_URL`, put the `apiUrl` in the file): exit 2 (Review Focus 3).
  14. `tokens revoke <id> --yes`, then the `ANCHOR_TOKEN` call → exit 3.
  15. `secrets delete DB_URL` without `--yes` → exit 2. With `--yes` → exit 0.
  16. `logout`, then `whoami` → exit 3.
- [ ] **Step 2: Run it.** Run `pnpm --filter ./apps/cli test:e2e`. Expected: steps fail until the harness works, then all pass. Set the timeout to 120 s for harness startup.
- [ ] **Step 3: Add the e2e job to CI** (after unit tests; Linux only).
- [ ] **Step 4: Commit** with `git commit -m "test(cli): end-to-end tests against a local Worker"`.

---

### Task 13: Distribution — Node bundle and Bun binaries

**Files:**
- Create: `apps/cli/build.mjs`, `.github/workflows/release-cli.yml`
- Modify: `apps/cli/package.json` (`bin`, `files`, `build` script), `docs/cli.md` (install section)

**Interfaces:**
- Produces (`build.mjs`): an esbuild bundle of `src/main.ts` to `dist/anchor.mjs` with `platform: "node"`, `format: "esm"`, `target: "node22"`, banner `#!/usr/bin/env node`, `define` for `CLI_VERSION` from `package.json`, and all dependencies bundled. `package.json` has `"bin": { "anchor": "dist/anchor.mjs" }`, `"files": ["dist"]` and keeps `"private": true` (placeholder name, no publishing in this milestone).
- Produces (`release-cli.yml`):
  - Trigger: tags `cli-v*` and `workflow_dispatch`. It runs a matrix build.
  - Each matrix job runs `oven-sh/setup-bun`, `pnpm install --frozen-lockfile`, and then `bun build apps/cli/src/main.ts --compile --target=<target> --define CLI_VERSION='"<version>"' --outfile dist/anchor-<os>-<arch>[.exe]`.
  - Targets: `bun-darwin-arm64`, `bun-darwin-x64`, `bun-linux-x64`, `bun-linux-arm64`, `bun-windows-x64`. **Verify these target strings and the `--define` syntax in the current Bun docs** (bun.com/docs, "Single-file executable").
  - On native runners it smoke-tests `./anchor-* --version` and `--help`.
  - A final job writes `SHA256SUMS` and uploads all binaries to a **draft** GitHub Release. There is no npm publish.

- [ ] **Step 1: Write the failing test** `apps/cli/test/integration/build.test.ts`: it runs `node build.mjs` and then `node dist/anchor.mjs --version`, and expects the `package.json` version on stdout and exit 0. It also runs `node dist/anchor.mjs secrets set X=1` and expects exit 2 (the argv guard survives bundling).
- [ ] **Step 2: Run it and confirm it fails.**
- [ ] **Step 3: Implement `build.mjs` and the `package.json` changes.**
- [ ] **Step 4: Run it and confirm it passes.**
- [ ] **Step 5: Verify a Bun binary locally if Bun is available.** Install Bun if needed (`curl -fsSL https://bun.sh/install | bash`, or skip and rely on CI). Run `bun build apps/cli/src/main.ts --compile --outfile /tmp/anchor` and then `/tmp/anchor --help`. Confirm `@inquirer/prompts` loads under Bun by running `/tmp/anchor login --api-url http://localhost:1` in a terminal: it must prompt for the email (Ctrl-C to abort, exit 130). Report any Bun incompatibility instead of working around it silently.
- [ ] **Step 6: Write the release workflow**, then lint it with `actionlint` if available.
- [ ] **Step 7: Run the full verification.** Run `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter ./apps/cli test:e2e`. Expected: all pass.
- [ ] **Step 8: Commit** with `git commit -m "build(cli): Node bundle and Bun binary release workflow"`.

---

## Reconciliation notes

(Filled in by Task 0.)

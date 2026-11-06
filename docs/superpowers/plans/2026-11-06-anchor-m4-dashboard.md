# Anchor M4 — Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Anchor web dashboard, a React SPA served by the same Worker as the API, covering setup, login, invite and reset flows, projects, the overview matrix, environment secrets, project settings, users and invites, the audit log, and the account page.

**Architecture:** `apps/web` is a Vite + React 19 SPA with file-based TanStack Router and TanStack Query. It talks to `/api/v1` with the session cookie and validates forms with the zod schemas from `@anchor/shared`. The build output `apps/web/dist` is served by the Worker's static assets in SPA mode, with `/api/*` routed to the Worker first. The UI follows the `dashboard-ui` skill: `tokens.css`, shadcn primitives restyled once in `components/ui`, one `AppShell`, Sheets for create and edit, Dialogs for confirm and one-time reveal. One server task adds the overview endpoint and the caller's project access.

**Tech Stack:** React ^19.3, Vite ^8.3, @vitejs/plugin-react ^6.2, @tanstack/react-router ^1.170 + @tanstack/router-plugin ^1.168, @tanstack/react-query ^5.106, Tailwind CSS ^4.3 + @tailwindcss/vite ^4.3, shadcn CLI ^4 (Radix primitives), class-variance-authority, clsx, tailwind-merge, react-hook-form + @hookform/resolvers (zod v4 resolver), sonner, react-icons ^5.7 (`react-icons/ri` only), @fontsource/inter + @fontsource/jetbrains-mono ^5.3, Vitest ^5.1 + jsdom ^31 + @testing-library/react ^16.3 + @testing-library/user-event + @testing-library/jest-dom, MSW ^3, @playwright/test ^1.65.

**Spec:** `docs/superpowers/specs/2026-11-06-anchor-design.md` (§7 API conventions, §10 Dashboard, §13 contracts, §13.7 web stack). Design source: `.claude/skills/dashboard-ui/SKILL.md`, `components.md` and `tokens.css`, plus the path rule `.claude/rules/dashboard-ui.md`. Load the `dashboard-ui` skill before every UI task.

## Global Constraints

- Code, comments, commits and docs are in English. Never commit `.dev.vars`, real tokens or Playwright state dirs.
- Colors, text sizes, radii and shadows come only from `tokens.css` utilities (`bg-bg-weak`, `text-text-sub`, `text-label-sm`, `rounded-lg`, `shadow-xs`, ...). Raw Tailwind palette colors (`slate|zinc|gray|emerald|amber|red|blue-[0-9]`) and arbitrary text sizes (`text-[...]`) are forbidden. A lint script enforces this (Task 2).
- Repeated looks live in `src/components/ui/*` variants. Call sites pass `variant`, `size` or `status` only, never size or color overrides.
- Icons come only from `react-icons/ri`: `size-4` in nav and buttons, `size-3.5` inline.
- Every list has loading (skeleton rows), empty, filtered-empty, error and forbidden states.
- **Secret values render masked (`••••••••`, `text-code-xs`) until an explicit reveal.** Revealed secret values, one-time tokens and links live only in React component state. They never enter the TanStack Query cache, `localStorage`/`sessionStorage`, the URL or logs (`console.*`).
- One-time tokens in URLs are read from `location.hash` (`#token=...`). The fragment is removed with `history.replaceState` **before** any network request.
- The `redirect` search param on `/login` is accepted only if `safeRedirect()` returns it (a same-origin path); anything else falls back to `/projects`.
- All requests use `credentials: "same-origin"` and `Content-Type: application/json`. The browser supplies `Origin`, so do not set it manually.
- Every UI task ends by running the `dashboard-ui` "Before you finish a UI change" checklist (8 items) on its diff, plus `pnpm --filter @anchor/web lint:tokens`.
- CSP (served via `_headers`): `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`, plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`.
- Environment tone (icon tile and tag color): `dev` → information, `staging` → warning, `prod` → error, anything else → feature. This lives in `lib/status.ts` only.

## Review Focus

1. **Secret values leaking into persistent client state:** after revealing a secret or creating a token, the value must not appear in the Query cache (`JSON.stringify(queryClient.getQueryCache().getAll().map(q => q.state.data))`), in storage or in the URL. Navigating away and back re-masks it. Tests are in Tasks 11 and 14.
2. **Open redirect through `/login?redirect=`:** `//evil.example`, `https://evil.example`, `/\evil.example`, `javascript:alert(1)` and `%2F%2Fevil.example` must all land on `/projects` after login, while `/projects/app/environments/dev?path=%2Fapi` is preserved. Tests are in Tasks 6 and 8.
3. **Session expiring mid-use:** any 401 from a non-auth endpoint clears the Query cache and redirects once to `/login?redirect=<current location>`, with no redirect loop on `/login` itself. A 403 shows the Forbidden state and does **not** log the user out. Tests are in Tasks 6 and 7.
4. **One-time tokens and links:**
   - The invite/reset token fragment is gone from `location` before the first fetch, and stays gone on failure.
   - The dialogs revealing new service tokens or invite/reset URLs cannot be dismissed by an outside click or Escape. They need an explicit "I've copied it" button, and the value cannot be retrieved after closing.
   - Tests are in Tasks 8, 14 and 15.
5. **CSP breaks the production build** (inline styles or scripts injected by Radix, sonner or fonts): the Playwright smoke fails on any console message containing `Content Security Policy` or `Refused to`, and a unit test pins the `_headers` content. Tests are in Tasks 3 and 18.

---

## File Structure

```
apps/server/
  wrangler.jsonc                      + assets block (Task 3)
  src/projects/overview.ts            overview query + access resolution (Task 1)
  src/projects/routes.ts              + GET /:project/overview, ProjectDto.access (Task 1)
  test/api/projects/overview.test.ts, test/api/assets-routing.test.ts   (layered layout, see docs/testing.md)
packages/shared/src/api.ts            + OverviewDto, ProjectAccessDto (Task 1)
apps/web/
  package.json, index.html, vite.config.ts, tsconfig.json, tsconfig.app.json, components.json
  playwright.config.ts, scripts/lint-tokens.mjs
  public/_headers
  src/main.tsx                        QueryClient + RouterProvider + Toaster
  src/router.ts                       createAppRouter({ queryClient, history? })
  src/routeTree.gen.ts                generated (committed)
  src/styles/globals.css              tokens.css + fontsource imports
  src/lib/cn.ts                       cn()
  src/lib/api/client.ts               apiFetch, ApiClientError, setUnauthenticatedHandler
  src/lib/api/endpoints.ts            one typed function per endpoint
  src/lib/api/query-keys.ts           qk.*
  src/lib/auth.ts                     meQueryOptions, setupStatusQueryOptions, requireUser, safeRedirect
  src/lib/fragment-token.ts           takeFragmentToken
  src/lib/format.ts                   formatDate, formatRelative
  src/lib/status.ts                   tokenStatus, inviteStatus, environmentTone, roleLabel
  src/lib/current-env.ts              useCurrentEnvironment (global env slug)
  src/components/ui/                  button, status-badge, tag, input, textarea, select, label, checkbox,
                                      table, dialog, sheet, dropdown-menu, popover, tooltip, skeleton, sonner
  src/components/data/                table-states.tsx, table-footer.tsx, filter-chip.tsx, search-chip.tsx
  src/components/secrets/             masked-value.tsx, secret-value-field.tsx
  src/components/overlays/            confirm-dialog.tsx, one-time-secret-dialog.tsx, form-sheet.tsx
  src/components/app-shell/           app-shell.tsx, sidebar.tsx, header.tsx, environment-switcher.tsx, user-menu.tsx
  src/components/auth-layout.tsx
  src/routes/__root.tsx
  src/routes/setup.tsx, login.tsx, accept-invite.tsx, reset-password.tsx
  src/routes/_app.tsx                 auth guard + AppShell
  src/routes/_app/index.tsx           → /projects
  src/routes/_app/projects/index.tsx
  src/routes/_app/projects/$project/index.tsx                 overview
  src/routes/_app/projects/$project/environments/$env.tsx     secrets (search: path)
  src/routes/_app/projects/$project/settings/environments.tsx
  src/routes/_app/projects/$project/settings/members.tsx
  src/routes/_app/projects/$project/settings/service-tokens.tsx
  src/routes/_app/users.tsx, audit.tsx, account.tsx
  test/                               tests live beside src/, never inside it (docs/testing.md)
    support/                          setup.ts, msw.ts, fixtures.ts, render.tsx, index.ts (no tests)
    unit/                             harness.test.tsx
      lib/                            mirror of src/lib: status, auth, fragment-token, api/client
      public/                         headers.test.ts (mirrors public/_headers)
      scripts/                        lint-tokens.test.ts
    components/                       mirror of src/components: ui/, app-shell/, composites.test.tsx
    routes/                           mirror of src/routes: public-pages.test.tsx, _app/**
    e2e/                              smoke.spec.ts, global-setup.ts, .state/ (gitignored)
```

---

### Task 0: Reconcile with merged M1–M3 code

**Files:**
- Modify: this plan only

- [ ] **Step 1: Check endpoint names and shapes.** For every endpoint in spec §13.4 that this plan consumes, compare the merged route files and `@anchor/shared` DTOs. Consumed endpoints:
  - setup and auth: `setup/status`, `setup`, `auth/login`, `auth/logout`, `auth/me`, `auth/password`, `auth/sessions`, `auth/password-reset`
  - invites: `invites`, `invites/inspect`, `invites/accept`
  - users: `users`, `users/:id/password-reset`
  - projects, environments and secrets
  - project resources: `members`, `service-tokens`, `audit`
- [ ] **Step 2: Check helper names.** Confirm the names of the server's M2 authorization helpers used in Task 1 (`authorize`, and whatever resolves a member's environment restriction and a token's scopes). Also confirm the audit pagination parameter, which this plan assumes is `before=<nextCursor>`.
- [ ] **Step 3: Fix the plan.** Rewrite any name in this plan that differs (Interfaces blocks and test snippets). Do not change merged code in this task.
- [ ] **Step 4: Commit** with `git commit -m "docs(plan): reconcile M4 plan with merged code"`, only if the plan changed.

---

### Task 1: Server — project overview endpoint and caller access

**Files:**
- Create: `apps/server/src/projects/overview.ts`
- Modify: `apps/server/src/projects/routes.ts`, `packages/shared/src/api.ts`
- Test: `apps/server/test/api/projects/overview.test.ts` (imports `#src/...` and `#test/support`)

**Interfaces:**
- Consumes: M2 `authorize(db, principal, action, resource)` and `visibleEnvironmentIds(db, principal, projectId)` (`src/authz/policy.ts`), `getMembership(db, projectId, userId)` → `MembershipRow { role, environment_ids: string[] | null }` (`src/members/repo.ts`; `environment_ids` holds environment **ids**, mapped to slugs through `listEnvironments`), `getProjectBySlug(db, slug)`, `listEnvironments(db, projectId)` (`src/projects/repo.ts`).
- Produces (shared):
  - `ProjectAccessDto { role: "admin" | "developer" | "viewer"; environments: string[] | null }`. Instance owners and admins map to `"admin"` with `null`. `environments` holds env slugs.
  - `ProjectDto.access?: ProjectAccessDto`. This is additive and present on `GET /projects` and `GET /projects/:project` for user principals.
  - `OverviewDto { environments: EnvironmentDto[]; keys: { key: string; cells: Record<string, { version: number; updatedAt: number } | null> }[] }`
- Produces (server): `resolveProjectAccess(db, principal, project): Promise<ProjectAccessDto | null>` (null = no access), `getOverview(db, project, environments: EnvironmentRow[], path: string): Promise<OverviewDto>` (one SQL query over `secrets` grouped by key, no decryption), and route `GET /api/v1/projects/:project/overview?path=` (path normalized with `secretPathSchema`, default `/`). The route needs `project:read`. Its `environments` contains only environments for which `authorize(..., "secret:read", { projectId, environmentId, path })` passes. No audit event, because no values are read. Keys are sorted ascending. A cell is `null` when the key is absent in that env.

- [ ] **Step 1: Write the failing tests** (`resetDb` and the HTTP/user factories come from `#test/support`; source from `#src/...`; `resetDb` in `beforeEach`, seed through the existing service functions):
  - `overview lists keys across envs with null for missing`: put `A` in dev+prod and `B` in staging. Expect keys `["A","B"]`, `A.cells.staging === null`, and `B.cells.dev === null`.
  - `overview never contains values`: put value `"OVERVIEW-CANARY"` and expect the response text not to contain it.
  - `overview respects path`: a secret at `/api` is absent from `path=/` and present in `path=/api`.
  - `developer restricted to dev sees only the dev column`: `environments` slugs are `["dev"]`, and cells have only the `dev` key.
  - `non-member gets 403`, `unauthenticated gets 401`, `unknown project gets 404`.
  - `GET /projects/:project includes access`: an owner gets `{ role: "admin", environments: null }`, and a viewer restricted to staging gets `{ role: "viewer", environments: ["staging"] }`.
  - `GET /projects lists access per project for members`.
- [ ] **Step 2: Run the tests and confirm they fail.** Run `pnpm --filter ./apps/server test -- overview`. Expected: FAIL (404 route).
- [ ] **Step 3: Implement** `overview.ts` and the route, and add `access` in the project serializers.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `pnpm --filter ./apps/server test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(server): project overview endpoint and caller access"`.

---

### Task 2: Web app scaffold, styling foundation and test harness

**Files:**
- Create: `apps/web/{package.json,index.html,vite.config.ts,tsconfig.json,tsconfig.app.json,components.json}`, `apps/web/src/{main.tsx,router.ts}`, `apps/web/src/routes/__root.tsx`, `apps/web/src/styles/globals.css`, `apps/web/src/lib/cn.ts`, `apps/web/scripts/lint-tokens.mjs`, `apps/web/test/support/{setup.ts,msw.ts,fixtures.ts,render.tsx,index.ts}`
- Test: `apps/web/test/unit/harness.test.tsx`, `apps/web/test/unit/scripts/lint-tokens.test.ts`

**Interfaces:**
- Produces:
  - `createAppRouter(opts: { queryClient: QueryClient; history?: RouterHistory }): Router`, with `context: { queryClient }` (root route created with `createRootRouteWithContext<{ queryClient: QueryClient }>()`).
  - `cn(...inputs: ClassValue[]): string` (clsx + tailwind-merge). Configure tailwind-merge with `extendTailwindMerge` so `text-label-*`, `text-paragraph-*` and `text-code-*` are font sizes, not colors.
  - Test helpers (in `apps/web/test/support/`, re-exported from `index.ts`; tests import them via `#test/support`, never through relative paths. `setup.ts` is only referenced by Vitest `setupFiles` and is not re-exported):
    - `renderApp(url: string, opts?: { queryClient?: QueryClient }): Promise<{ router; queryClient; user: UserEvent }>`: real route tree, `createMemoryHistory({ initialEntries: [url] })`, waits for `router.load()`.
    - `server` (MSW `setupServer`).
    - `fixtures` (`owner`, `member`, `project`, `envs`, `secrets`, `serviceToken`, `invite`, `auditEvents`), typed with the `@anchor/shared` DTOs.
    - `apiError(status, code, message)` builds an MSW JSON error response.
  - `lint:tokens` script: `node scripts/lint-tokens.mjs src` exits 1 and prints `file:line` for any match of `/\b(?:bg|text|border|ring|fill|stroke)-(?:slate|zinc|gray|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/`, `/text-\[/` or `/\buppercase\b/` in `.tsx`/`.css` files under `src/` (excluding `styles/globals.css`). `neutral-alpha-*` and `bg-neutral-alpha-*` are allowed because they are tokens; the regex requires a digit right after the hue.

- [ ] **Step 1: Create the package.** Name `@anchor/web`, `type: module`. Scripts:
  - `dev`: `vite`, with a proxy `/api` → `http://localhost:8787`
  - `build`: `tsc -b && vite build`
  - `test`: `vitest run`
  - `test:unit`: `vitest run test/unit`
  - `test:components`: `vitest run test/components`
  - `test:routes`: `vitest run test/routes`
  - `typecheck`: `tsc -b --noEmit`
  - `lint:tokens`
  - `e2e`: `playwright test`

  Add the dependencies from Tech Stack, plus `@anchor/shared: workspace:*`. Add a subpath import, as in `apps/server/package.json`: `"imports": { "#test/support": "./test/support/index.ts" }`. Vite and TypeScript (`moduleResolution: Bundler`) both resolve it, so it needs no alias or `paths` entry. Source imports from tests use `@/...`.
- [ ] **Step 2: Configure Vite.** Plugins, in order: `tanstackRouter({ target: "react", autoCodeSplitting: true })` from `@tanstack/router-plugin/vite`, then `react()`, then `tailwindcss()` from `@tailwindcss/vite`. Alias `@` → `./src`. Vitest config in the same file: `environment: "jsdom"`, `setupFiles: ["./test/support/setup.ts"]`, `include: ["test/**/*.test.{ts,tsx}"]`, `exclude: ["test/e2e/**", "node_modules/**"]` (Playwright owns `test/e2e`), `css: false`. `tsconfig.app.json` has `include: ["src", "test"]` and `paths: { "@/*": ["./src/*"] }`. **Verify** the plugin import name and options against the TanStack Router "File-Based Routing → Vite" install docs and the Tailwind v4 Vite guide before writing them. Do not rely on memory.
- [ ] **Step 3: Run shadcn init.** Run `pnpm dlx shadcn@latest init` in `apps/web` (Tailwind v4 mode, CSS file `src/styles/globals.css`, alias `@/components`, base color neutral, CSS variables on). **Verify** the init flow for Tailwind v4 in the current shadcn docs (it must not create a `tailwind.config.*`). Then replace the generated `globals.css` body with the full contents of `.claude/skills/dashboard-ui/tokens.css`. Keep any `@import` that shadcn's components need (e.g. `tw-animate-css`) after `@import "tailwindcss"`. Add `@import "@fontsource/inter/400.css"`, `500.css`, `600.css` and `@import "@fontsource/jetbrains-mono/400.css"` in `main.tsx`.
- [ ] **Step 4: Wire the root.** `main.tsx` creates one `QueryClient` with `defaultOptions.queries: { retry: false, refetchOnWindowFocus: false }`. Task 6 replaces `retry` with `(n, e) => !(e instanceof ApiClientError && e.status < 500) && n < 2`., mounts `<RouterProvider router={createAppRouter({ queryClient })} />` inside `QueryClientProvider`, and adds `<Toaster position="bottom-right" />` (Task 4 restyles it). `__root.tsx` renders `<Outlet />`. Commit the generated `routeTree.gen.ts`, and make Biome ignore it.
- [ ] **Step 5: Write the failing tests.**
  - `test/unit/harness.test.tsx`: `renders the root route at /` (a placeholder `routes/index.tsx` renders `"Anchor"`; Task 7 removes it), and `MSW intercepts fetch` (a handler for `GET /api/v1/health` returns `{status:"ok"}` and `fetch` gets it).
  - `test/unit/scripts/lint-tokens.test.ts`: a temp dir containing a file with `bg-gray-100`, `text-[13px]` and `uppercase` → exit code 1 with 3 hits. A file with `bg-bg-weak text-label-sm bg-neutral-alpha-100` → exit code 0.
- [ ] **Step 6: Run the tests and confirm they fail, then implement until they pass.** Run `pnpm --filter @anchor/web test`.
- [ ] **Step 7: Check the build.** Run `pnpm --filter @anchor/web build && pnpm --filter @anchor/web lint:tokens`. Expected: `apps/web/dist/index.html` exists and lint exits 0.
- [ ] **Step 8: Commit** with `git commit -m "chore(web): scaffold dashboard SPA with tokens, router, query and test harness"`.

---

### Task 3: Serve the SPA from the Worker

**Files:**
- Create: `apps/web/public/_headers`
- Modify: `apps/server/wrangler.jsonc`, `apps/server/package.json`, root `package.json`, `.github/workflows/ci.yml`, `docs/deploy.md`
- Test: `apps/web/test/unit/public/headers.test.ts` (mirrors `public/`), `apps/server/test/api/assets-routing.test.ts` (app-wide behavior, top of the `api` layer)

**Interfaces:**
- Produces:
  - `wrangler.jsonc` `assets: { "directory": "../web/dist", "binding": "ASSETS", "not_found_handling": "single-page-application", "run_worker_first": ["/api/*"] }`, with `ASSETS: Fetcher` added to `Bindings`.
  - Root scripts: `build` (`pnpm --filter @anchor/web build`) and `deploy` (`pnpm build && pnpm --filter ./apps/server deploy`).
  - `apps/server` `pretest` script: `node -e "require('node:fs').mkdirSync('../web/dist',{recursive:true})"`, so server tests run without a web build. Add the same hook for each layer script (`pretest:unit`, `pretest:integration`, `pretest:api`), because npm runs `pre<script>` per script name and `pretest` does not cover `test:<layer>`.
- `_headers` content: `/*` gets the CSP and headers from Global Constraints. `/index.html` and `/` get `Cache-Control: no-cache`. `/assets/*` gets `Cache-Control: public, max-age=31536000, immutable`.

- [ ] **Step 1: Write the failing tests.**
  - `test/unit/public/headers.test.ts` reads `public/_headers` and asserts:
    - the `/*` block contains the exact CSP string from Global Constraints, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `X-Frame-Options: DENY`
    - the CSP contains no `'unsafe-inline'` and no `'unsafe-eval'`
  - `test/api/assets-routing.test.ts` (imports `#src/...` and `#test/support`):
    - `unknown /api route still returns the JSON 404`
    - `/api/v1/health still served by the worker`
- [ ] **Step 2: Run the tests and confirm they fail** (`_headers` missing).
- [ ] **Step 3: Implement** the config, scripts and `_headers`. **Verify** the `assets` keys against the Workers Static Assets SPA routing docs; this plan relies on `run_worker_first` needing Wrangler ≥ 4.20. Update CI: after install, run `pnpm build` before `pnpm test`. Add to `docs/deploy.md` that `pnpm deploy` builds the dashboard first.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Check manually.** Run `pnpm build`, then start `wrangler dev` from `apps/server` (with `.dev.vars` from M1).
  - `curl -i localhost:8787/projects/x/environments/dev`: 200, `text/html`, with the CSP header.
  - `curl -i localhost:8787/api/v1/nope`: 404 JSON.
- [ ] **Step 6: Commit** with `git commit -m "feat: serve dashboard from worker static assets with security headers"`.

---

### Task 4: UI primitives restyled per `components.md`

**Files:**
- Create (via `pnpm dlx shadcn@latest add button input textarea select label checkbox dialog sheet dropdown-menu popover tooltip skeleton sonner`, then restyle): `apps/web/src/components/ui/{button,input,textarea,select,label,checkbox,dialog,sheet,dropdown-menu,popover,tooltip,skeleton,sonner}.tsx`. Hand-written: `status-badge.tsx`, `tag.tsx`, `table.tsx`.
- Test: `apps/web/test/components/ui/primitives.test.tsx`

**Interfaces:**
- Produces:
  - `Button` with `variant: "primary" | "secondary" | "ghost" | "dashed" | "error" | "error-ghost"` and `size: "md" | "sm" | "xs" | "2xs" | "icon" | "icon-xs"` (default `secondary`/`xs`), using the exact `buttonVariants` string from `components.md`.
  - `StatusBadge` `{ status: "success" | "warning" | "error" | "info" | "neutral"; icon?: boolean; children }`, with its default leading icon from `components.md`.
  - `Tag` `{ tone?: "feature" | "neutral" }`, where neutral is the path/key chip look.
  - `Input` `{ invalid?: boolean; leadingIcon?: IconType; compact?: boolean }`, `Textarea` (same ring and invalid styles), `Select` (Radix, trigger styled like Input).
  - Table parts: `Table`, `TableHeader`, `TableBody`, `TableRow` (`clickable?: boolean`), `TableHead`, `TableCell` (`primary?: boolean`), `TableContainer`, with classes from the `components.md` Table table.
  - `Dialog*` and `Sheet*` (side `right` only) with the overlay, content, header, body and footer classes from `components.md`. `SheetBody` and `DialogFooter` are exported parts.
  - `DropdownMenu*` (item `destructive?: boolean`), `Popover*`, `Tooltip*`, `Skeleton` (`h-5 w-[14ch] animate-pulse rounded-full bg-neutral-alpha-100`; width via a `width` prop: `"8ch" | "14ch" | "24ch"`), and `Toaster` (sonner, one-line, bottom-right).

- [ ] **Step 1: Write the failing tests:**
  - `button primary uses brand tokens`: the class contains `bg-primary-base` and `hover:bg-primary-darker`.
  - `button default is secondary xs`.
  - `status badge maps statuses to tinted tokens` (table-driven over 5 statuses: `bg-<s>-lighter` / `text-<s>-base`, with neutral → `bg-faded-lighter text-text-sub`).
  - `table head is sentence case and tokenized`: `th` has `text-label-sm text-text-sub` and not `uppercase`.
  - `sheet renders title, body and footer with bg-bg-weak footer`.
  - `input invalid uses ring-error-base`.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Add the primitives with the shadcn CLI and restyle each one once** with the `components.md` classes. Remove any shadcn default palette or `text-muted-foreground` usage from these files.
- [ ] **Step 4: Run the tests and confirm they pass.** Run `pnpm --filter @anchor/web test && pnpm --filter @anchor/web lint:tokens`.
- [ ] **Step 5: Run the `dashboard-ui` checklist (items 1–5) on the diff.**
- [ ] **Step 6: Commit** with `git commit -m "feat(web): restyled UI primitives"`.

---

### Task 5: Composite components — table states, filters, overlays, masked values

**Files:**
- Create: `apps/web/src/components/data/{table-states,table-footer,filter-chip,search-chip}.tsx`, `apps/web/src/components/overlays/{confirm-dialog,one-time-secret-dialog,form-sheet}.tsx`, `apps/web/src/components/secrets/{masked-value,secret-value-field}.tsx`, `apps/web/src/lib/{format,status}.ts`
- Test: `apps/web/test/components/composites.test.tsx` (one file named after the feature group; it spans `components/data`, `overlays` and `secrets`), `apps/web/test/unit/lib/status.test.ts`

**Interfaces:**
- Produces (`table-states.tsx`):
  - `TableSkeletonRows { columns: ("8ch" | "14ch" | "24ch")[]; rows?: number = 5 }`
  - `EmptyState { icon: IconType; title: string; description: string; action?: ReactNode; secondaryAction?: ReactNode }`, using the `components.md` empty-state anatomy
  - `FilteredEmptyState { onClear: () => void; what: string }`, which renders "No results match {what}" and a "Clear filters" ghost button
  - `ErrorState { error: unknown; onRetry: () => void }`
  - `ForbiddenState { what: string }`, which renders "You don't have access to {what}" with `RiForbidLine`
- Produces (`table-footer.tsx`): `TableFooter { total: number | null; label?: string; canPrev: boolean; canNext: boolean; onPrev(); onNext(); pageSize: number; pageSizes: number[]; onPageSize(n) }`. It renders `"{total} results"` (or `"{n} shown"` when the total is null), the joined pager and the `"{n} / page"` select.
- Produces (filters):
  - `FilterChip<T extends string> { label: string; options: { value: T; label: string }[]; value: T[]; onChange(v: T[]) }`: a dashed `xs` button `⊕ {label}` that opens a popover with a checkbox list. When active it shows `{label}: {first}{+n}` and a clear `×`.
  - `SearchChip { value: string; onChange(v: string); placeholder: string }`: a dashed chip that becomes an `h-8` compact Input on click, autofocused. The `/` key focuses it when no input has focus.
- Produces (overlays):
  - `ConfirmDialog { open; onOpenChange; title: string; description: ReactNode; confirmLabel: string; destructive?: boolean; onConfirm: () => Promise<void> }`. It disables its buttons while pending and closes on success.
  - `OneTimeSecretDialog { open; title: string; label: string; value: string; notice: string; onDone: () => void }`. It prevents `onInteractOutside` and `onEscapeKeyDown`. Its only close control is the primary "I've copied it" button (no X), and it shows the value box with a copy button.
  - `FormSheet { open; onOpenChange; title; description; submitLabel; pending: boolean; onSubmit; children }`, with a sticky footer (Cancel secondary, submit primary).
- Produces (secrets):
  - `MaskedValue { reveal: () => Promise<string>; onCopied?: () => void }`. It shows `••••••••`, and on hover shows reveal (`RiEyeLine`) and copy (`RiFileCopyLine`) `icon-xs` ghost buttons. Revealed text lives in local `useState`, and the eye toggles it back to masked. Copy calls `reveal()` when needed, writes `navigator.clipboard.writeText`, shows `RiCheckLine` for 1.5 s and toasts "Copied". It re-masks on unmount.
  - `SecretValueField { value: string; onChange; mode: "new" | "edit"; touched: boolean; onLoadCurrent?: () => Promise<string> }`. It is a mono textarea. In `edit` mode it starts empty with hint "Leave untouched to keep the current value" and a "Reveal current value" ghost button.
- Produces (`format.ts`): `formatDate(ms): string` (`"Apr 2, 2026"`, `en-US`) and `formatRelative(ms, now = Date.now()): string` (`"3 minutes ago"`, via `Intl.RelativeTimeFormat`).
- Produces (`status.ts`): `tokenStatus(t: ServiceTokenDto, now): { status; label: "Active" | "Expiring" | "Expired" | "Revoked" }` (expiring = < 7 days left), `inviteStatus(i: InviteDto, now)` (`Pending` info, `Accepted` success, `Expired` neutral, `Revoked` neutral), `environmentTone(slug): "information" | "warning" | "error" | "feature"`, `roleLabel(role)`.

- [ ] **Step 1: Write the failing tests:**
  - `masked value hides text until reveal and re-masks on toggle`: the DOM has no value text before the click, and the `reveal` mock is called once.
  - `copy writes to clipboard and shows Copied toast` (mock `navigator.clipboard`).
  - `one-time dialog ignores Escape and outside click; closes only via the done button`.
  - `confirm dialog calls onConfirm and disables the button while pending`.
  - `filter chip shows the active value and clears`.
  - `search chip turns into an input and focuses on "/"`.
  - `table footer renders "N results" and disables prev on the first page`.
  - `tokenStatus` boundaries: revoked wins over expired; 6 days 23 h left → Expiring; exactly 7 days → Active. Also `environmentTone("prod") === "error"`.
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass**, along with `lint:tokens`.
- [ ] **Step 5: Run the `dashboard-ui` checklist (items 1–5, 7, 8).**
- [ ] **Step 6: Commit** with `git commit -m "feat(web): table states, filter chips, overlays and masked values"`.

---

### Task 6: API client, query keys, auth guard helpers

**Files:**
- Create: `apps/web/src/lib/api/{client,endpoints,query-keys}.ts`, `apps/web/src/lib/{auth,fragment-token}.ts`
- Test: `apps/web/test/unit/lib/api/client.test.ts`, `apps/web/test/unit/lib/auth.test.ts`, `apps/web/test/unit/lib/fragment-token.test.ts`

**Interfaces:**
- Produces (`client.ts`):
  - `class ApiClientError extends Error { status: number; code: ErrorCode | "network_error" | "invalid_response"; message: string }`
  - `apiFetch<T>(path: string, init?: { method?; body?: unknown; query?: Record<string, string | number | boolean | undefined> }): Promise<T>`:
    - prefixes `/api/v1`
    - sends `credentials: "same-origin"` and JSON content-type when there is a body
    - parses the JSON error body into `ApiClientError` and maps a network failure to `network_error`
    - returns `undefined` for 204
  - `setUnauthenticatedHandler(fn: () => void)`. The handler is called on 401 except for paths in `AUTH_PATHS = ["/auth/me", "/auth/login", "/setup", "/setup/status", "/invites/inspect", "/invites/accept", "/auth/password-reset"]`.
- Produces (`endpoints.ts`): one function per consumed endpoint, named `api.<resource>.<verb>`:
  - `api.setup.status/submit`
  - `api.auth.me/login/logout/changePassword/sessions/revokeSession/resetPassword`
  - `api.invites.list/create/revoke/inspect/accept`
  - `api.users.list/update/remove/createPasswordReset`
  - `api.projects.list/get/create/update/remove/overview`
  - `api.environments.list/create/update/remove`
  - `api.secrets.list/get/put/remove` (`list` never passes `reveal=true`; `get` is the only value-returning call)
  - `api.members.list/add/update/remove`
  - `api.serviceTokens.list/create/revoke`
  - `api.audit.list/listForProject`
  
  All are typed with the `@anchor/shared` DTOs.
- Produces (`query-keys.ts`): `qk = { me: ["me"], setupStatus: ["setup-status"], projects: ["projects"], project: (p) => ["projects", p], overview: (p, path) => ["projects", p, "overview", path], environments: (p) => ["projects", p, "environments"], secrets: (p, e, path) => ["projects", p, "environments", e, "secrets", path], members: (p) => [...], serviceTokens: (p) => [...], users: ["users"], invites: ["invites"], audit: (filters) => ["audit", filters], projectAudit: (p, filters) => [...], sessions: ["sessions"] }`. No key ever holds secret values.
- Produces (`auth.ts`): `meQueryOptions` (`staleTime: 60_000`), `setupStatusQueryOptions`, `requireUser({ context, location }): Promise<UserDto>` (used in `_app` `beforeLoad`: `ensureQueryData(me)`. On 401 it checks the setup status: `needsSetup` → `throw redirect({ to: "/setup" })`, else `throw redirect({ to: "/login", search: { redirect: location.href } })`), and `safeRedirect(raw: unknown): string`.
  - `safeRedirect` returns `raw` only if it is a string that starts with `/`, does not start with `//` or `/\`, contains no `\`, has no control characters, and resolves via `new URL(raw, "http://x")` to origin `http://x`. Otherwise it returns `"/projects"`.
- Produces (`fragment-token.ts`): `takeFragmentToken(expectedPrefix: "anc_inv_" | "anc_rst_"): string | null`. It reads `token` from `location.hash`, **always** calls `history.replaceState(history.state, "", location.pathname + location.search)` when a hash exists, and returns the token only if it starts with the prefix.
- `main.tsx` registers `setUnauthenticatedHandler`: `queryClient.clear()`, then `router.navigate({ to: "/login", search: { redirect: router.state.location.href } })`, unless already on `/login`.

- [ ] **Step 1: Write the failing tests:**
  - `apiFetch parses error bodies into ApiClientError with status and code`
  - `apiFetch returns undefined on 204`
  - `network failure -> code network_error`
  - `401 on /projects calls the unauthenticated handler once; 401 on /auth/login does not`
  - `403 does not call the unauthenticated handler` (Review Focus 3)
  - `api.secrets.list never sends reveal=true` (inspect the MSW request URL)
  - `safeRedirect` table:
    - keeps `"/projects"` and `"/projects/app/environments/dev?path=%2Fapi"`
    - falls back for `"//evil.example"`, `"https://evil.example"`, `"/\\evil.example"`, `"javascript:alert(1)"`, `"%2F%2Fevil.example"`, `""`, `undefined`, `"/\tfoo"` (Review Focus 2)
  - `takeFragmentToken returns the token and strips the hash`, `strips the hash even for a wrong prefix and returns null`, `returns null without touching history when no hash`
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit** with `git commit -m "feat(web): typed API client, query keys and auth helpers"`.

---

### Task 7: App shell, auth-guarded layout, navigation

**Files:**
- Create: `apps/web/src/components/app-shell/{app-shell,sidebar,header,environment-switcher,user-menu}.tsx`, `apps/web/src/lib/current-env.ts`, `apps/web/src/routes/_app.tsx`, `apps/web/src/routes/_app/index.tsx`
- Delete: the placeholder `routes/index.tsx` from Task 2
- Test: `apps/web/test/components/app-shell/app-shell.test.tsx`

**Interfaces:**
- Consumes: `requireUser`, `meQueryOptions`, `api.projects.get`, `api.environments.list`, `api.auth.logout`.
- Produces:
  - `_app` route: `beforeLoad: requireUser`, component `<AppShell><Outlet/></AppShell>`. `_app/index` redirects to `/projects`.
  - `AppShell { children }`, following the `components.md` App shell section.
  - `Sidebar`:
    - Org row: logo tile and "Anchor".
    - `EnvironmentSwitcher` card, shown only under `/projects/$project/*`. Elsewhere it shows "Select a project" and links to `/projects`.
    - Group "Project" (when a project is in the route): Overview, Secrets (→ `/projects/$project/environments/$currentEnv`), Environments, Members, Service tokens.
    - Group "Workspace": Projects, plus Users and Audit log only when `me.role` is owner or admin.
    - "Account" pinned at the bottom (`mt-auto`).
    - Nav links use `activeProps` for the selected style.
  - `Header { title: ReactNode; actions?: ReactNode }`. Pages set the title through a route `staticData.title` or a `useHeader()` context. Pick one, which is `HeaderContext` with `useSetHeader({ title, actions })`, and use it everywhere.
  - `UserMenu`: avatar initials and a dropdown with the name and email, "Account", and "Log out". Log out calls `api.auth.logout`, then `queryClient.clear()`, then navigates to `/login`.
  - `useCurrentEnvironment(projectSlug, environments): [slug, setSlug]`: the env slug from the route when on an env page, else the last chosen slug from `localStorage["anchor.currentEnv"]` (try/catch) if the project has it, else the first environment. Switching from the card navigates to the same page type with the new env.
  - `EnvironmentSwitcher`: card with an `environmentTone` icon tile and the env name (`text-label-md`), and a popover listing environments the caller can access (`project.access.environments`).

- [ ] **Step 1: Write the failing tests** (`renderApp` + MSW):
  - `unauthenticated visit to /projects redirects to /login?redirect=%2Fprojects`
  - `fresh instance redirects to /setup`: `/auth/me` 401 and `needsSetup: true`
  - `owner sees Users and Audit log; member does not`
  - `project routes show the Project group and the environment card with the current env`
  - `switching environment navigates to the same view in the new env and persists the choice`
  - `a 401 from any page query redirects once to login with the current location; the query cache is empty afterwards` (Review Focus 3)
  - `log out clears cache and lands on /login`
  - `title appears in the header bar, not in content` (heading text is inside `header`)
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass**, along with `lint:tokens`.
- [ ] **Step 5: Run the `dashboard-ui` checklist (all 8).**
- [ ] **Step 6: Commit** with `git commit -m "feat(web): app shell, navigation and auth-guarded layout"`.

---

### Task 8: Public pages — setup, login, accept invite, reset password

**Files:**
- Create: `apps/web/src/components/auth-layout.tsx`, `apps/web/src/routes/{setup,login,accept-invite,reset-password}.tsx`
- Test: `apps/web/test/routes/public-pages.test.tsx`

**Interfaces:**
- Consumes: `api.setup.*`, `api.auth.login`, `api.invites.inspect/accept`, `api.auth.resetPassword`, `safeRedirect`, `takeFragmentToken`, the shared schemas (`setupBodySchema`, `loginBodySchema`, `passwordSchema`), and `FormSheet`-style fields (Input/Label/hint/error).
- Produces:
  - `AuthLayout { title: string; description?: string; children }`: a full-height `bg-bg-weak` page centered on a white `rounded-xl border bg-bg-white p-6 shadow-xs w-full max-w-sm` panel with the logo. This is the one sanctioned card outside templates and empty states; note it in a code comment.
  - `/setup`:
    - Fields: setup token (password input), name, email, password, confirm password.
    - Client validation uses `setupBodySchema` and a password match check.
    - If `needsSetup === false`, redirect to `/login`.
    - `setup_disabled` (503) shows a callout: "Setup is disabled. Set the ANCHOR_SETUP_TOKEN secret on the Worker and reload." `forbidden` shows "Invalid setup token".
    - Success: set the `me` query data, then navigate to `/projects`.
  - `/login` (search schema `{ redirect?: string }`):
    - Fields: email and password.
    - `invalid_credentials` → "Invalid email or password". `rate_limited` → "Too many failed attempts. Try again in 15 minutes."
    - Success → `navigate({ to: safeRedirect(search.redirect) })`.
    - Already authenticated → redirect the same way.
  - `/accept-invite`:
    - On mount: `takeFragmentToken("anc_inv_")`. A missing or invalid token shows "This invite link is invalid or has expired" and the 404 copy.
    - Otherwise call `inspect`, then show the email (read-only), role, name, password and confirm fields.
    - `accept` → `/projects`.
  - `/reset-password`: `takeFragmentToken("anc_rst_")` → new password and confirm → `resetPassword` → toast "Password updated, sign in again" → `/login`.
  - The token lives in `useState` (not search params). Strict mode double effects must not lose it: read it in a `useState` initializer guarded by a module-level `consumed` ref that resets on unmount, or read in the route `beforeLoad` and pass it via route context. Choose route context, which is simpler to test.

- [ ] **Step 1: Write the failing tests:**
  - `setup happy path lands on /projects`, `setup_disabled shows the callout`, `wrong setup token shows error`, `mismatched passwords block submit`, `already set up redirects to /login`
  - `login preserves a safe redirect`, `login ignores //evil.example redirect and lands on /projects` (Review Focus 2), `invalid credentials message`, `rate limited message`
  - `accept invite: the hash is stripped before inspect is called`: assert `window.location.hash === ""` inside the MSW `inspect` handler (Review Focus 4)
  - `accept invite: invalid token shows expired message and hash is stripped`
  - `reset password: token from fragment is sent in body, never in the URL`: the MSW handler asserts the request URL has no `anc_rst_`
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass**, along with `lint:tokens`.
- [ ] **Step 5: Run the `dashboard-ui` checklist.**
- [ ] **Step 6: Commit** with `git commit -m "feat(web): setup, login, invite and password reset pages"`.

---

### Task 9: Projects list and create project

**Files:**
- Create: `apps/web/src/routes/_app/projects/index.tsx`
- Test: `apps/web/test/routes/_app/projects/projects.test.tsx`

**Interfaces:**
- Consumes: `api.projects.list/create`, `qk.projects`, `createProjectBodySchema`, Table parts, `TableFooter`, `SearchChip`, `FormSheet`, the states from Task 5.
- Produces:
  - Page title "Projects". Toolbar: `SearchChip` (client-side filter on name and slug) on the left. A primary `sm` "New project" button on the right, shown only for instance owners and admins.
  - Table columns: Project (name, with the slug as `text-code-xs` second line and `RiFolder3Line`), Your role (`Tag`), Created (`formatDate`, with a relative tooltip). The row is clickable and goes to the overview.
  - Client pagination is 10 per page.
  - The create Sheet has Name and Slug fields. The slug is auto-derived from the name until the user edits it (lowercase, `-` for runs of invalid chars, trimmed to 63). On success: invalidate `qk.projects`, close the Sheet, then navigate to the overview.
  - A 409 shows "Slug already in use" on the slug field.

- [ ] **Step 1: Write the failing tests:**
  - `loading shows skeleton rows`, `empty state for owner offers New project; for member explains to ask an admin`
  - `search filters and shows filtered-empty with Clear filters`
  - `create derives slug, submits, and navigates to the overview`
  - `slug conflict shows a field error`
  - `server error shows ErrorState with retry`
  - `row click opens the project`
- [ ] **Step 2: Run the tests and confirm they fail.** **Step 3: Implement.** **Step 4: Run the tests and confirm they pass**, along with `lint:tokens`.
- [ ] **Step 5: Run the `dashboard-ui` checklist.**
- [ ] **Step 6: Commit** with `git commit -m "feat(web): projects list and creation"`.

---

### Task 10: Project overview matrix

**Files:**
- Create: `apps/web/src/routes/_app/projects/$project/index.tsx`
- Test: `apps/web/test/routes/_app/projects/$project/overview.test.tsx`

**Interfaces:**
- Consumes: `api.projects.get`, `api.projects.overview`, `qk.overview`, Table parts, `SearchChip`, `FilterChip`, the states.
- Produces:
  - Header title = project name. Search params: `{ path: string = "/" }`, validated with `secretPathSchema` (an invalid path is replaced by `/`).
  - Toolbar: `SearchChip` (key filter), a `FilterChip` "Status" with options `Missing somewhere` and `Present everywhere`, and a path breadcrumb (Tag-styled segments; clicking one sets `path`).
  - Matrix table: the first column is Key (`RiKey2Line`, `text-label-sm`), then one column per returned environment (header shows the env name, with the slug in `text-code-xs`). A present cell shows `RiCheckboxCircleFill` in `text-success-base`, with a tooltip `v{version} · {relative}`. A missing cell shows a `StatusBadge status="warning"` with "Missing". Clicking a cell navigates to `/projects/$project/environments/$env?path=…`.
  - The footer shows `N results` and client pagination of 25.
  - The empty state (no keys at the path) has an "Add a secret" primary button that goes to the current env's secrets page.
  - A 403 shows `ForbiddenState`.

- [ ] **Step 1: Write the failing tests:**
  - `renders a column per environment returned by the API (restricted user sees only dev)`
  - `missing cells show the Missing badge; present cells show version tooltip`
  - `Status filter "Missing somewhere" hides complete rows; filtered-empty offers clear`
  - `cell click navigates to the env page with path`
  - `invalid path search param falls back to /`
  - `forbidden shows ForbiddenState`
  - `no value text is ever rendered` (the fixture has no values; assert no `••••` and no value column)
- [ ] **Step 2: Run the tests and confirm they fail.** **Step 3: Implement.** **Step 4: Run the tests and confirm they pass**, along with `lint:tokens`.
- [ ] **Step 5: Run the `dashboard-ui` checklist.**
- [ ] **Step 6: Commit** with `git commit -m "feat(web): project overview matrix"`.

---

### Task 11: Environment secrets view

**Files:**
- Create: `apps/web/src/routes/_app/projects/$project/environments/$env.tsx`, `apps/web/src/routes/_app/projects/$project/environments/-components/{secret-sheet,secrets-table}.tsx`
- Test: `apps/web/test/routes/_app/projects/$project/environments/secrets.test.tsx`

**Interfaces:**
- Consumes: `api.secrets.list/get/put/remove`, `qk.secrets`, `putSecretBodySchema`, `secretKeySchema`, `MaskedValue`, `SecretValueField`, `FormSheet`, `ConfirmDialog`, `SearchChip`, the states, `project.access`.
- Produces:
  - Header title = `{project name} · {env name}`. Search `{ path = "/" }` as in Task 10.
  - Toolbar: `SearchChip` (key), a path breadcrumb, and a `"Go to path"` dashed chip opening a popover with a path input (validated with `secretPathSchema`). On the right, a primary "Add secret" button, shown only when `access.role !== "viewer"` and the env is in `access.environments` (or that is `null`).
  - Section label: "Secrets in {path}".
  - Table columns: Key (`RiKey2Line`, name, comment as `text-paragraph-xs text-text-soft` second line), Value (`MaskedValue` whose `reveal` calls `api.secrets.get` **directly, not through `useQuery`**), Version (`v{n}`), Updated (date with relative tooltip), and a `⋮` menu (Edit, Copy key, Delete). The `⋮` menu stops propagation; the row is not clickable.
  - The add Sheet has Key, Value (`SecretValueField mode="new"`) and Comment.
  - The edit Sheet has Key (read-only), Value (`mode="edit"`) and Comment. On submit, if the value is untouched it calls `api.secrets.get` first and re-sends that value with the new comment.
  - Results:
    - Success toasts "Secret saved" and invalidates `qk.secrets` and `qk.overview`.
    - A 409 toasts "This secret was changed elsewhere. Reload and try again." and keeps the Sheet open.
    - A 413 shows the field error "Value is larger than 64 KiB".
  - Delete opens `ConfirmDialog` (destructive, title "Delete secret `KEY`", description includes the env name) → `api.secrets.remove` → toast.
  - The value-returning fetches use `useMutation` (or plain async calls), never `useQuery`.

- [ ] **Step 1: Write the failing tests:**
  - `list shows keys with masked values; the list request has no reveal param`
  - `reveal calls GET secrets/:key once and shows the value; toggling re-masks`
  - `revealed value is not in the query cache`: after reveal, `JSON.stringify(queryClient.getQueryCache().getAll().map(q => q.state.data))` does not contain the value (Review Focus 1)
  - `navigating to another env and back shows the value masked again` (Review Focus 1)
  - `copy fetches the value and writes it to the clipboard`
  - `add secret validates key (1BAD rejected client-side) and submits path from search`
  - `edit with untouched value re-sends the current value and the new comment`
  - `409 on save shows conflict toast and keeps the sheet open`
  - `delete confirm names the key and calls DELETE with path`
  - `viewer sees no Add button and no Edit/Delete items`
  - `empty state at a path offers Add secret; filtered-empty clears the search`
- [ ] **Step 2: Run the tests and confirm they fail.** **Step 3: Implement.** **Step 4: Run the tests and confirm they pass**, along with `lint:tokens`.
- [ ] **Step 5: Run the `dashboard-ui` checklist** (item 8 is critical here).
- [ ] **Step 6: Commit** with `git commit -m "feat(web): environment secrets view"`.

---

### Task 12: Project settings — environments

**Files:**
- Create: `apps/web/src/routes/_app/projects/$project/settings/environments.tsx`
- Test: `apps/web/test/routes/_app/projects/$project/settings/environments.test.tsx`

**Interfaces:**
- Consumes: `api.environments.*`, `createEnvironmentBodySchema`, `updateEnvironmentBodySchema`.
- Produces:
  - Title "Environments". Table columns: Environment (tone icon tile, name, slug second line), Position, Created, `⋮` (Rename, Delete).
  - "New environment" primary button opens a Sheet (name, slug). Rename uses a Sheet with the name only.
  - Delete uses `ConfirmDialog` with the description "Deletes every secret in {name}". A 409 "last environment" is shown as an error toast with the server message.
  - The list is readable by every member, so non-admins get no `ForbiddenState`. Instead, the create button and the row actions are hidden when `access.role !== "admin"`.
  - Invalidates `qk.environments`, `qk.overview` and `qk.project`.

- [ ] **Step 1: Write the failing tests:**
  - `lists environments in position order`
  - `create, rename, delete flows call the API and refresh`
  - `deleting the last environment shows the server conflict message`
  - `non-admin sees no actions`
  - `empty/loading/error states`
- [ ] **Step 2–4: Confirm the tests fail, implement, then confirm they pass** along with `lint:tokens`.
- [ ] **Step 5: Run the `dashboard-ui` checklist.**
- [ ] **Step 6: Commit** with `git commit -m "feat(web): environment settings"`.

---

### Task 13: Project settings — members

**Files:**
- Create: `apps/web/src/routes/_app/projects/$project/settings/members.tsx`
- Test: `apps/web/test/routes/_app/projects/$project/settings/members.test.tsx`

**Interfaces:**
- Consumes: `api.members.list/add/update/remove`, `api.environments.list`, `MemberDto`.
- Produces:
  - Title "Members". Toolbar: `SearchChip` (name or email) and `FilterChip` "Role". Primary "Add member" button.
  - Table columns: Member (initials circle, name, email second line), Role (`Tag`), Environments (`Tag` per env slug, or "All environments" neutral tag), `⋮` (Edit, Remove).
  - The add/edit Sheet has Email (add only), Role (Select: Admin, Developer, Viewer, with a one-line hint each) and Environments. The Environments field is a "All environments" checkbox; when unchecked, it shows one checkbox per environment, and at least one must be checked. A project admin cannot be restricted (`addMemberBodySchema` refine), so with role Admin the field is fixed to "All environments" and `environments: null` is sent.
  - The add flow handles 404 from the server (user not found): field error "No user with this email. Invite them from Users first."
  - Remove uses `ConfirmDialog` ("Remove {name} from {project}").
  - The members query returning 403 renders `ForbiddenState`.

- [ ] **Step 1: Write the failing tests:**
  - `list renders roles and env tags; All environments when null`
  - `add with restricted envs sends environment slugs`
  - `unchecking All environments with no env selected blocks submit`
  - `unknown email shows the invite hint`
  - `edit role and remove member call the API`
  - `403 renders ForbiddenState`
  - `filtered-empty for role filter`
- [ ] **Step 2–4: Confirm the tests fail, implement, then confirm they pass** along with `lint:tokens`.
- [ ] **Step 5: Run the `dashboard-ui` checklist.**
- [ ] **Step 6: Commit** with `git commit -m "feat(web): project members management"`.

---

### Task 14: Project settings — service tokens

**Files:**
- Create: `apps/web/src/routes/_app/projects/$project/settings/service-tokens.tsx`
- Test: `apps/web/test/routes/_app/projects/$project/settings/service-tokens.test.tsx`

**Interfaces:**
- Consumes: `api.serviceTokens.list/create/revoke`, `tokenStatus`, `OneTimeSecretDialog`, `ConfirmDialog`.
- Produces:
  - Title "Service tokens". Toolbar: `SearchChip` (name) and `FilterChip` "Status" (Active, Expiring, Expired, Revoked). Primary "New token" button.
  - Table columns: Token (`RiShieldKeyholeLine`, name, `tokenPrefix…` second line in `text-code-xs`), Permission (`Tag`: Read / Read & write), Scopes (`Tag` per scope `env:/path`), Status (`StatusBadge` via `tokenStatus`), Expires (date), Last used (relative or `–`), `⋮` (Revoke, disabled when already revoked).
  - The create Sheet has:
    - Name (1–64).
    - Permission (Select).
    - A Scopes repeater: rows of an environment Select plus a path Input (default `/`, validated with `secretPathSchema`), with "Add scope" and a remove button per row, and at least one row.
    - Expires in (Select: 7, 30, 90 or 365 days, default 90).
  - On create success: close the Sheet, then open `OneTimeSecretDialog` with title "Copy your service token", label = name and value = `token`. The notice reads "This token is shown once. Store it in your CI secret store now." Then invalidate `qk.serviceTokens`. The token string is held only in dialog state and cleared on `onDone`.
  - Revoke uses `ConfirmDialog` (error variant, "Revoke token `{name}`").

- [ ] **Step 1: Write the failing tests:**
  - `list shows status badges from tokenStatus (active, expiring, revoked)`
  - `create sends scopes with env slugs and normalized paths`
  - `invalid scope path blocks submit`
  - `after create the one-time dialog shows the token; Escape and outside click do not close it` (Review Focus 4)
  - `after Done the token is gone from the DOM and from the query cache` (Review Focus 1)
  - `revoke confirm names the token and calls DELETE`
  - `403 renders ForbiddenState`, `empty and filtered-empty states`
- [ ] **Step 2–4: Confirm the tests fail, implement, then confirm they pass** along with `lint:tokens`.
- [ ] **Step 5: Run the `dashboard-ui` checklist.**
- [ ] **Step 6: Commit** with `git commit -m "feat(web): service token management with one-time reveal"`.

---

### Task 15: Instance users and invites

**Files:**
- Create: `apps/web/src/routes/_app/users.tsx`, `apps/web/src/routes/_app/-components/{users-table,invites-table}.tsx`
- Test: `apps/web/test/routes/_app/users.test.tsx`

**Interfaces:**
- Consumes: `api.users.*`, `api.invites.*`, `inviteStatus`, `OneTimeSecretDialog`, `ConfirmDialog`. The route guard redirects non-admins to `/projects` (`beforeLoad` checks `me.role`).
- Produces:
  - Title "Users". Two sections with section labels "Users" and "Invites", each with its own table and footer.
  - Users toolbar: `SearchChip`, `FilterChip` "Role", `FilterChip` "Status" (Active, Disabled). Primary "Invite user" button.
  - Users table columns: User (initials, name, email), Role (`Tag`), Status (`StatusBadge` success Active / neutral Disabled), Created, `⋮`. The menu has: Change role (a submenu, owner-only for the owner role), Disable/Enable, "Create password reset link", and Delete.
    - The reset link opens `OneTimeSecretDialog` with the URL and expiry, notice "Send this link to {name}. It works once and expires in 1 hour."
    - A 409 last-owner response shows the server message toast.
  - Invites table columns: Email, Role, Status (`inviteStatus`), Expires, `⋮` Revoke (pending only).
  - The invite Sheet has Email and Role (Admin/Member, plus Owner for owners). On success, `OneTimeSecretDialog` shows the invite URL, notice "Share this link with {email}. It works once and expires in 72 hours."
  - A user cannot change their own role, disable or delete themself, or create a reset link for themself (the server answers 409): those items are hidden for `me.id`.

- [ ] **Step 1: Write the failing tests:**
  - `non-admin is redirected to /projects`
  - `users list with role and status filters; filtered-empty`
  - `invite shows the one-time URL dialog that cannot be dismissed accidentally` (Review Focus 4)
  - `reset link dialog shows URL once`
  - `last owner conflict shows server message`
  - `own row hides role/disable/delete actions`
  - `revoke invite only for pending`
- [ ] **Step 2–4: Confirm the tests fail, implement, then confirm they pass** along with `lint:tokens`.
- [ ] **Step 5: Run the `dashboard-ui` checklist.**
- [ ] **Step 6: Commit** with `git commit -m "feat(web): instance users and invites"`.

---

### Task 16: Audit log

**Files:**
- Create: `apps/web/src/routes/_app/audit.tsx`, `apps/web/src/components/audit/audit-table.tsx`
- Modify: `apps/web/src/components/app-shell/sidebar.tsx` (add a project "Audit log" link for project admins → `/audit?projectId=` handled by the same page using `api.audit.listForProject` when the user is not an instance admin)
- Test: `apps/web/test/routes/_app/audit.test.tsx`

**Interfaces:**
- Consumes: `api.audit.list/listForProject`, `AUDIT_ACTIONS` (shared), `api.users.list` (actor options, for admins), `api.projects.list`.
- Produces:
  - Title "Audit log". Search params: `{ projectId?: string; actorId?: string; action?: AuditAction; limit: 25 | 50 | 100 = 50 }`, validated with zod and kept in the URL so links are shareable. The API filters by one `action` (`auditQuerySchema.action` is a single enum), so the Action `FilterChip` keeps only the most recently picked value.
  - Toolbar: `FilterChip` "Action" (options from `AUDIT_ACTIONS`), "Actor", "Project". No search chip.
  - Table columns: Time (absolute, with relative tooltip), Actor (initials, label, type tag for service tokens), Action (`Tag` with `text-code-xs`), Target (`text-code-xs`), Project (slug or `–`), IP (`text-code-xs`). The row is clickable and opens a Sheet with read-only detail: all fields plus the metadata JSON in a `bg-bg-weak rounded-lg text-code-xs` pre block.
  - Cursor pagination: keep a stack of `before` cursors in component state. Next uses `nextCursor`; Prev pops. `TableFooter` gets `total = null` (label "{n} shown"), and the page size maps to `limit`.
  - Filters reset the cursor stack.

- [ ] **Step 1: Write the failing tests:**
  - `renders events with action tags and actor labels`
  - `next page sends before=<nextCursor>; prev returns to the first page`
  - `changing a filter resets pagination and updates the URL`
  - `detail sheet shows metadata and never a value field`
  - `project admin without instance role uses the project audit endpoint`
  - `403 ForbiddenState`, `empty and filtered-empty states`
- [ ] **Step 2–4: Confirm the tests fail, implement, then confirm they pass** along with `lint:tokens`.
- [ ] **Step 5: Run the `dashboard-ui` checklist.**
- [ ] **Step 6: Commit** with `git commit -m "feat(web): audit log viewer"`.

---

### Task 17: Account — change password and sessions

**Files:**
- Create: `apps/web/src/routes/_app/account.tsx`
- Test: `apps/web/test/routes/_app/account.test.tsx`

**Interfaces:**
- Consumes: `api.auth.changePassword/sessions/revokeSession/logout`, `passwordSchema`, `SessionDto`.
- Produces:
  - Title "Account". The content is capped at `max-w-3xl` (settings form).
  - Section "Profile": name and email, read-only.
  - Section "Password": current, new and confirm fields, plus a primary "Update password" button. Success toasts "Password updated. Other sessions were signed out." and invalidates `qk.sessions`.
  - Section "Sessions": table columns Device (kind `Tag` web/cli, user agent truncated), Created, Last used (relative), Expires, plus a "This session" `StatusBadge` (info) on the current row. The `⋮` Revoke action is hidden on the current row, which shows a "Log out" ghost button instead.
  - Wrong current password → field error with the server message.

- [ ] **Step 1: Write the failing tests:**
  - `password change validates match and length, calls API, refreshes sessions`
  - `wrong current password shows field error`
  - `current session is marked and cannot be revoked from the menu`
  - `revoking another session calls DELETE and refreshes`
  - `loading/empty/error states for sessions`
- [ ] **Step 2–4: Confirm the tests fail, implement, then confirm they pass** along with `lint:tokens`.
- [ ] **Step 5: Run the `dashboard-ui` checklist.**
- [ ] **Step 6: Commit** with `git commit -m "feat(web): account page with password change and sessions"`.

---

### Task 18: Playwright smoke against `wrangler dev`, CI e2e job, final gate

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/test/e2e/global-setup.ts`, `apps/web/test/e2e/smoke.spec.ts` (`playwright.config.ts` sets `testDir: "./test/e2e"` and `globalSetup: "./test/e2e/global-setup.ts"`)
- Modify: `.github/workflows/ci.yml`, `.gitignore` (add `apps/web/test/e2e/.state/`, `apps/web/test-results/`, `apps/web/playwright-report/`), `README.md` (dashboard dev instructions)

**Interfaces:**
- `global-setup.ts`:
  - Generates a random root key and setup token in memory.
  - Writes them to `process.env.E2E_SETUP_TOKEN` for the spec.
  - Runs `wrangler d1 migrations apply anchor --local --persist-to ../web/test/e2e/.state` from `apps/server`.
- The Playwright `webServer` command is `pnpm --filter @anchor/web build && pnpm --filter ./apps/server exec wrangler dev --port 8788 --persist-to ../web/test/e2e/.state --var ANCHOR_ROOT_KEY:$KEY --var ANCHOR_SETUP_TOKEN:$TOKEN`. Pass the values through the `webServer.env` mapping and a small node launcher script if shell interpolation is awkward. `baseURL` is `http://localhost:8788`, and the browser is Chromium only.
  - **Verify** that `wrangler dev` supports `--persist-to` and `--var` in the installed version (`wrangler dev --help`). If secrets cannot be passed that way, write a temporary `.dev.vars.e2e` and use `--env-file`, deleting it in global teardown. Never write over `apps/server/.dev.vars`.

- [ ] **Step 1: Write the smoke test** (`test/e2e/smoke.spec.ts`):
  - Collect `page.on("console")` errors and fail at the end if any message contains `Content Security Policy` or `Refused to` (Review Focus 5).
  - `/` redirects to `/setup`. Fill in the token, name, email and password, then submit → `/projects`.
  - Create project "Smoke App" → overview.
  - Go to Secrets (dev), add `HELLO` = `world-smoke-123`, then save.
  - The table shows `HELLO` with `••••••••`, and the page text does not contain `world-smoke-123`.
  - Click reveal → the text `world-smoke-123` is visible.
  - Reload the page → the value is masked again.
  - Check the response headers of the document request: the CSP header equals the Global Constraints string.
  - Log out → `/login`. Log in again → `/projects`.
- [ ] **Step 2: Run it and confirm it fails or passes appropriately.** Run `pnpm --filter @anchor/web exec playwright install chromium && pnpm --filter @anchor/web e2e`. Expected: PASS. Fix the app, not the test, if a CSP violation appears (e.g. import sonner's CSS file instead of relying on runtime style injection, if that is the cause).
- [ ] **Step 3: Add a CI job.** Add an `e2e` job after `test`: install, `pnpm build`, `playwright install --with-deps chromium`, `pnpm --filter @anchor/web e2e`. Upload `playwright-report` on failure.
- [ ] **Step 4: Run the final gate.** Run `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @anchor/web lint:tokens && pnpm --filter @anchor/web e2e`. Expected: all green. Run the `dashboard-ui` checklist over the whole `apps/web/src` tree once more.
- [ ] **Step 5: Commit** with `git commit -m "test(web): Playwright smoke against wrangler dev and CI e2e job"`.

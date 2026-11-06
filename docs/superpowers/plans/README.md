# Anchor implementation plans

Spec: [`../specs/2026-11-06-anchor-design.md`](../specs/2026-11-06-anchor-design.md). Execute in
order. Each milestone merges before the next one starts. Every plan after M1 begins with
"Task 0: Reconcile", which checks the names it consumes against the merged code and fixes the plan
first.

| # | Plan | Tasks | Depends on | Delivers |
|---|------|-------|------------|----------|
| M1 | [Core API foundation](2026-11-06-anchor-m1-core-api.md) | 14 | — | Monorepo, D1 schema, envelope crypto, setup/login/sessions, projects, environments, secrets with versions |
| M2 | [Access control & audit](2026-11-06-anchor-m2-access-audit.md) | 0 + 11 | M1 | Users, invites, password reset, memberships, service tokens, audit log |
| M3 | [CLI](2026-11-06-anchor-m3-cli.md) | 0 + 13 | M1, M2 | `anchor` CLI, keychain storage, `run`/`export`, binaries |
| M4 | [Dashboard](2026-11-06-anchor-m4-dashboard.md) | 0 + 18 | M1–M3 | React SPA served by the Worker, overview endpoint |
| M5 | [Advanced secrets](2026-11-06-anchor-m5-advanced-secrets.md) | 0 + 18 | M1–M4 | Folders, history/rollback, references, imports, KEK and root key rotation (server + CLI + web) |

Cross-plan names (endpoints, DTOs, token formats, audit actions) are fixed in spec §13. A plan may add
internals but must not rename anything listed there.

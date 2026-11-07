---
title: Architecture
description: The pieces of an Anchor instance, how a request flows through them, and the key hierarchy.
sidebar:
  order: 3
---

An Anchor instance is one Cloudflare Worker and the platform resources it binds to.

```
                    ┌──────────────────────────── Cloudflare ────────────────────────────┐
 browser ──HTTPS──▶ │  Worker (Hono)                                                     │
 anchor CLI ──────▶ │   ├─ /api/v1/*  ── authenticate ─▶ authorize ─▶ service ─▶ D1       │
 CI (token) ──────▶ │   ├─ static assets: the dashboard (SPA, apps/web/dist)             │
                    │   ├─ queue consumer ◀── anchor-reencrypt (dead letters: -dlq)      │
                    │   └─ cron 0 3 * * *: purge old audit events, resume rotations     │
                    │                                                                     │
                    │  Worker secrets: ANCHOR_ROOT_KEY (+ _ID, _PREVIOUS, _PREVIOUS_ID)   │
                    └─────────────────────────────────────────────────────────────────────┘
```

| Piece | Role |
|-------|------|
| **Worker** (`apps/server`) | HTTP API on Hono, the queue consumer and the scheduled handler, in one script |
| **D1** | The source of truth: users, sessions, projects, environments, members, service tokens, wrapped project keys, encrypted secret versions, the audit log |
| **Queues** | `anchor-reencrypt` carries project-key rotation batches; `anchor-reencrypt-dlq` catches messages that exhaust their retries |
| **Static assets** | The dashboard (`apps/web`, React) built into `apps/web/dist` and served by the same Worker |
| **Cron Trigger** | Daily at 03:00 UTC: deletes audit events older than 365 days and re-sends idle rotations |
| **CLI** (`apps/cli`) | A client of the same HTTP API, for developers and CI |

D1 is strongly consistent, so a revoked token or a removed member is denied on the next request:
authorization reads memberships and tokens from D1 on every call, with no cache. Anchor does not
use KV.

## A secret read, step by step

1. The request carries a session (the `__Host-anchor_session` cookie from the dashboard, or a
   bearer session from the CLI) or a service token (`Authorization: Bearer`, CI).
2. The Worker hashes the presented token and looks it up in D1. Expired or revoked: `401`.
3. `authorize()` checks the action (`secret:read`) against the instance role, the project
   membership (role and allowed environments) or the token's scopes. Denied: `403`.
4. The service loads the encrypted version, unwraps the project key with the root key, and
   decrypts the value. With `expand=true` it resolves `${...}` references (each hop authorized
   the same way); with `includeImports=true` it adds the secrets of imported folders.
5. The read is written to the audit log **before** the value is returned. If the audit insert
   fails, the read fails: no unaudited secret reads.

## Key hierarchy

```
ANCHOR_ROOT_KEY  (256-bit, Worker secret, id ANCHOR_ROOT_KEY_ID, default "rk1")
 └─ wraps (AES-256-GCM, AAD "anchor/kek/v1|<project>|<version>")
    Project key (KEK), one per project and version, stored wrapped in D1
     └─ encrypts (AES-256-GCM, AAD "anchor/secret/v1|<project>|<environment>|<secret>|<version>")
        Secret value, one ciphertext per secret version
```

- Every encryption uses a fresh random 96-bit IV.
- The AAD binds each ciphertext to its row: a ciphertext copied to another secret, version,
  environment or project fails to decrypt.
- Rotating a project key creates a new KEK version and re-encrypts values in the background
  ([runbook](/anchor/operations/project-key-rotation/)). Rotating the root key re-wraps the KEKs
  only ([runbook](/anchor/operations/root-key-rotation/)).

## Repository layout

| Path | What |
|------|------|
| `apps/server` | The Worker, D1 migrations, queue consumer, cron |
| `apps/web` | The dashboard |
| `apps/cli` | The `anchor` CLI |
| `apps/docs` | This site |
| `packages/shared` | Zod schemas and types shared by all three |

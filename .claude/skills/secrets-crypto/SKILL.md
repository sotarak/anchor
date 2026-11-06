---
name: secrets-crypto
description: Use when designing or implementing anything that stores, encrypts, decrypts, rotates, shares, or authorizes access to secrets in Anchor — key hierarchy, WebCrypto on Workers, envelope encryption, API/service tokens, audit logs, or choosing where secret data lives (D1, Durable Objects, KV, R2).
---

# Secrets & Crypto for Anchor

## Overview

Anchor's whole value is that secrets are safe. Mistakes here are silent until they are catastrophic,
so: **use standard primitives through WebCrypto, never invent schemes, write tamper tests first, and
make the threat model explicit before writing code.**

Workers runtime and Cloudflare product details change. Verify APIs, limits, and product availability
(for example Secrets Store) against current Cloudflare docs; see `workers-best-practices`.

## Decide the threat model first

Before implementing storage or encryption, the design doc must answer:

1. **Can the server see plaintext?**
   - *Server-side encryption* (server holds keys): enables integrations, secret references, dynamic
     secrets, server-side rotation. A compromise of the Worker + root key exposes data.
   - *End-to-end encryption* (only clients hold keys): the server stores ciphertext only. Much harder:
     key sharing between members, recovery, CI identities, and integrations all need client-side
     crypto.
   - Pick one per feature deliberately and record it. Do not drift between models.
2. Who are the attackers: a leaked API token, a malicious org member, a compromised CI runner, a
   database dump, a Cloudflare account takeover?
3. What must be auditable, and for how long?

Bring this to `brainstorming` if it is not already decided in `docs/`.

## Key hierarchy (server-side model)

```
Root key (Worker secret / Secrets Store binding, per deployment environment)
  └─ wraps → Org/Project KEK (random 256-bit, stored wrapped, has key_id + version)
       └─ wraps → DEK (random 256-bit, per secret version or per project+env)
            └─ encrypts → secret value (AES-256-GCM)
```

- **Algorithm:** AES-256-GCM via `crypto.subtle`. Random 96-bit IV from `crypto.getRandomValues` for
  every encryption. Never reuse an IV with the same key.
- **AAD:** bind ciphertext to its context, for example `org_id|project_id|env|secret_name|version|key_id`.
  This stops an attacker with DB write access from swapping ciphertexts between rows.
- **Store with every ciphertext:** `alg`, `key_id`, `key_version`, `iv`, ciphertext+tag. Format is
  versioned so it can evolve.
- **Root key:** never in source, `wrangler` config vars, logs, or test fixtures. Separate key per
  environment (dev/staging/prod). Import it once per isolate as a non-extractable `CryptoKey`.
- **Rotation:** new KEK version encrypts new data; old versions stay available for decryption; a
  background job (Queues/Workflows) re-wraps DEKs. Never re-encrypt everything in one request.

## Primitives cheat sheet

| Need | Use | Never |
|------|-----|-------|
| Random IDs / tokens | `crypto.getRandomValues`, `crypto.randomUUID()` | `Math.random()` |
| Encrypt data | AES-256-GCM with unique IV + AAD | AES-CBC without MAC, ECB, homemade XOR |
| Compare tokens/MACs | `crypto.subtle.timingSafeEqual` (Workers extension) on equal-length buffers | `===` on secrets |
| Store API tokens | SHA-256 of a high-entropy (≥128-bit) random token + a short prefix for lookup | Plaintext tokens |
| Store user passwords (if any) | Slow KDF (PBKDF2 with high iterations in WebCrypto); check CPU-time limits, or delegate auth to an IdP | Fast hashes |
| Sign payloads / webhooks | HMAC-SHA-256 or Ed25519 | Unsigned JSON |

## Where data lives (verify current semantics in docs)

- **Source of truth for secrets and ACLs:** a strongly consistent store (D1, or Durable Object SQLite
  storage for per-entity coordination). Consider a DO per project/env to serialize writes and versioning.
- **KV is eventually consistent**: do not use it for revocation checks, permission state, or anything
  where a stale read leaks access. Acceptable only for derived, re-validatable caches.
- **R2:** large blobs or encrypted backups/exports, never unencrypted secret material.
- Ciphertext only at rest, everywhere, including backups, exports, and queues.

## Access control & tokens

- Authorize **every** read and write against org → project → environment → path permissions. No
  "internal" endpoints that skip checks.
- Machine/service tokens: scoped (project, env, read/write), expiring, revocable, last-used tracking.
- Revocation must take effect immediately (strongly consistent check, or short-TTL cache with explicit
  invalidation).

## Logging & audit

- Never log secret values, decrypted payloads, tokens, or keys. Redact at the logger level, not call sites.
- Append-only audit events for: secret read (who/what token, which secret, not the value), create,
  update, delete, rotate, permission change, token issue/revoke, login.
- Audit records include actor, IP/user agent, timestamp, and request id. Treat audit log tampering
  as an incident.

## Required tests (write first)

- Round-trip encrypt/decrypt for every key version
- **Tamper:** flipping one bit in ciphertext, tag, or IV makes decryption fail
- **AAD mismatch:** moving a ciphertext to another row/env fails to decrypt
- IV uniqueness across many encryptions
- Rotation: old data readable after KEK rotation; re-wrap job is idempotent
- Authorization: each role/token scope denied outside its scope; revoked token denied immediately
- Logs and errors contain no secret values (assert on captured logs)

## Red flags — stop and reconsider

- "We'll add encryption later", "just base64 it for now"
- Deterministic IVs, or an IV derived from the secret name
- Keys or tokens in `wrangler.jsonc` `vars`, `.dev.vars` committed, or test snapshots
- Using KV for permission checks
- A custom crypto construction not in the table above

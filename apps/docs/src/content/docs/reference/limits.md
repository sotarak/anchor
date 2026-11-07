---
title: Limits
description: Every size, count, length and lifetime limit Anchor enforces, as defined in the code.
sidebar:
  order: 2
---

Values below are read from the source (`packages/shared/src` and `apps/server/src`). A request
over a limit fails with `400 bad_request`, or `413 payload_too_large` for an oversized secret value.

## Names and identifiers

| Item | Rule |
|------|------|
| Project and environment slug | `^[a-z0-9][a-z0-9-]{0,62}$` (1–63 characters, lowercase) |
| Project and environment name | 1–64 characters |
| Secret key | `^[A-Za-z_][A-Za-z0-9_]{0,254}$` (a valid environment variable name, up to 255 characters) |
| Folder path | `/` or `/a/b`: segments of `[A-Za-z0-9_-]+`, at most 10 segments and 256 characters; a trailing `/` is dropped |
| User name | 1–100 characters |
| Email | up to 254 characters |
| Password | 12–1,024 characters |
| Service token name | 1–64 characters |

## Secrets

| Item | Limit |
|------|-------|
| Secret value | 65,536 bytes (UTF-8) |
| Secret comment | 500 characters |
| Reference chain depth | 5 hops |
| Distinct secrets loaded to expand one request | 500 |
| One expanded value | 1,048,576 bytes (1 MiB) |
| Bytes added by references across one request | 16,777,216 bytes (16 MiB) |

## Access

| Item | Limit |
|------|-------|
| Service token scopes | 1–20 `{ environment, path }` pairs |
| Service token lifetime | 1–365 days (CLI default 90) |
| Environments in one membership | 1–50 |
| Dashboard session | 7 days |
| CLI session | 30 days |
| Invite link | 72 hours |
| Password-reset link | 1 hour |
| Failed logins before lockout | 5, then locked for 15 minutes |

## Audit and background work

| Item | Limit |
|------|-------|
| Audit retention | 365 days |
| Audit event metadata | 16,384 bytes; key lists inside it are capped at 10,240 bytes |
| Audit page size | 1–200 events (default 50) |
| Re-encryption batch | 100 secret versions per queue message |
| Rotation retries | 30 s, doubling, capped at 3,600 s; the rotation fails on the 10th attempt |
| Idle rotation resumed after | 15 minutes (daily cron, or the next rotate call) |

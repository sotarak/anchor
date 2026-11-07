---
title: Introduction
description: What Anchor is, who it is for, and what it deliberately is not.
sidebar:
  order: 1
---

Anchor is a self-hosted secrets and configuration manager that runs entirely on Cloudflare's
developer platform. One Worker serves the HTTP API and the dashboard; D1 stores encrypted secrets,
users and the audit log; Queues re-encrypt values in the background when a key rotates. A CLI
injects secrets into local processes and CI jobs.

## Who it is for

- **Small teams** that want one place for application secrets per project and environment
  (`dev`, `staging`, `prod`, ...), with roles, history and an audit trail.
- **Teams already on Cloudflare** that would rather run one more Worker than operate a Vault
  cluster or pay per seat for a hosted product.
- **CI pipelines** that need short-lived, scoped, revocable read access to one environment.

## What you get

- Projects, environments and folders, with secrets encrypted at rest (AES-256-GCM, envelope
  encryption under a per-project key).
- Instance roles (owner, admin, member) and project roles (admin, developer, viewer).
- Service tokens scoped to environments and folders, read-only or read-write, with an expiry.
- Secret references (`${KEY}`, `${prod:/db/PASSWORD}`), folder imports, version history and
  rollback.
- An append-only audit log, kept for 365 days.
- Online project-key and root-key rotation.
- A dashboard and a scriptable CLI (`anchor run -- <command>`).

## Why Cloudflare

Workers, D1 and Queues give a globally deployed API with no servers to patch and a strongly
consistent database for secrets and permissions. The whole instance is one `wrangler deploy` on
the Workers Paid plan (password hashing needs more CPU per login than the Free plan allows).

## What Anchor is not

- **Not end-to-end encrypted.** The server holds the keys and decrypts values to serve them. This
  is what makes references, imports and server-side rotation possible. Someone who controls your
  Cloudflare account (the Worker and its secrets) can read every value. See the
  [security model](/anchor/security/model/).
- **Not a multi-tenant SaaS.** One deployment is one instance with its own users.
- **Not a dynamic-secrets engine.** Anchor stores values you put in it; it does not mint database
  credentials or cloud keys on demand.

Anchor is pre-1.0. Expect breaking changes between minor versions; the
[changelog](https://github.com/sotarak/anchor/blob/main/CHANGELOG.md) lists them.

Next: [Quickstart](/anchor/start/quickstart/).

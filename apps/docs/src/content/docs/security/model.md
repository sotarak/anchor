---
title: Security model
description: What Anchor protects against, how secrets are encrypted and authorized, and the known gaps.
sidebar:
  order: 1
---

To report a vulnerability, follow the
[security policy](https://github.com/sotarak/anchor/blob/main/SECURITY.md). Do not open a public
issue.

## Trust model

Anchor uses **server-side encryption**. The Worker holds the root key and decrypts values to serve
them. That is a deliberate choice: it is what makes references, imports, rollback and online key
rotation work, and it lets CI read secrets with a plain bearer token.

| Attacker | Outcome |
|----------|---------|
| Gets a copy of the D1 database (export, backup, leaked dump) | Sees metadata (users, project and secret names, audit events) and the PBKDF2 password hashes, which allow offline password guessing, but **no secret values**: those are AES-256-GCM ciphertexts under keys wrapped by a root key that is not in the database |
| Can write to D1 but not run the Worker | Can grant themselves access (insert a session or token hash, change a role or a scope) and then read everything through the API, or point a secret back at an older version. The AAD only stops a ciphertext being moved to another secret, version, environment or project. **Protect D1 write access like access to the Worker** |
| Steals a service token | Reads (or writes, for `read-write`) only the environments and folders in its scopes, until it expires or is revoked; every value read and every write is audited with the token's id (listing names is not) |
| Steals a session | Acts as that user until the session expires (7 days for the dashboard, 30 days for the CLI) or is revoked from the **Account** page |
| A malicious project member | Limited to the member's role and allowed environments; cannot read the audit log unless a project admin |
| Reaches a freshly deployed instance's URL before its owner exists | **Becomes the owner**: the first account created at `/setup` owns the instance. Nothing is stored yet at that point, but create the owner right after the deploy, and start over with an empty database if `/setup` says an owner exists that you did not create (see [Troubleshooting](/anchor/troubleshooting/#setup-says-the-instance-already-has-an-owner)) |
| Controls your Cloudflare account, or the Worker and its secrets | **Reads everything.** Anchor cannot protect against the platform it runs on |

## Encryption

- Values are encrypted with AES-256-GCM through WebCrypto, with a fresh random 96-bit IV each time.
- Each project has its own key (KEK), versioned; the root key wraps every KEK. See the
  [key hierarchy](/anchor/start/architecture/#key-hierarchy).
- Every ciphertext stores its algorithm and key version, and is bound by AAD to project,
  environment, secret and version.
- The root key is a Worker secret. It is never in source, `wrangler.jsonc`, logs, the database or
  test fixtures. Losing it loses every value: there is no recovery path by design.

## Authentication

- Passwords: PBKDF2-SHA-256, 100,000 iterations (the workerd maximum), per-user salt.
- 5 failed logins in a row lock the account for 15 minutes.
- Sessions, service tokens, invite links and password-reset links are high-entropy random tokens
  with a type prefix (`anc_s_`, `anc_st_`, `anc_inv_`, `anc_rst_`). Only their SHA-256 hash is
  stored. Invite links last 72 hours, reset links 1 hour.
- The dashboard session is an `HttpOnly`, `Secure` `__Host-` cookie. State-changing requests
  authenticated by cookie must carry the instance's own `Origin`, or they are rejected (CSRF).
- Service tokens are accepted only as `Authorization: Bearer`, never from a cookie.

## Authorization

Every route calls one policy function before it touches data. It reads memberships and tokens from
D1 on every request, so removal and revocation take effect immediately.

| Principal | Can |
|-----------|-----|
| Instance **owner** / **admin** | Everything: projects, users, invites, the instance audit log, every project's secrets. Only owners can manage owners, and the last active owner cannot be demoted, disabled or deleted |
| Instance **member** | Only the projects they are a member of |
| Project **admin** | Environments, members, service tokens, key rotation and the project audit log, plus read and write secrets |
| Project **developer** | Read and write secrets in the environments the membership allows |
| Project **viewer** | Read secrets in the environments the membership allows |
| Service token | Read (or read and write) secrets in its scopes, `{ environment, folder }` pairs; a folder scope covers its subfolders |

References and imports are authorized hop by hop: expanding `${prod:/db/PASSWORD}` requires read
access to `prod:/db`, and a forbidden target is a `403` whether it exists or not.

## Audit

- Append-only: a database trigger rejects every `UPDATE` and any `DELETE` of a row younger than
  365 days.
- Logged: logins (successful and failed), every value read (listing names without values is not
  logged), writes, deletes,
  rollbacks, permission and membership changes, token creation and revocation, key rotations.
- Every event has the actor (user or service token), IP address, user agent, time and target.
  Events never contain secret values or tokens.
- A secret read that cannot be audited fails.

## Known gaps

- **No end-to-end encryption.** See the trust model above.
- **No built-in IP rate limiting.** Add a Cloudflare rule in front of the auth endpoints; see
  [Rate limiting](/anchor/operations/rate-limiting/).
- **Break-glass recovery leaves no audit event.** It is a direct D1 update; see
  [Break-glass recovery](/anchor/operations/break-glass/).
- **First-run setup is open until the owner exists.** `/setup` asks for no token; the first account
  created there owns the instance. Create it right after deploying.
- **No SSO or MFA yet.** Accounts are email and password.
- **Pre-1.0.** Only the latest release gets security fixes.

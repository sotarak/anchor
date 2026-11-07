---
title: HTTP API
description: Base URL, authentication, the error envelope and every route group of the Anchor API.
sidebar:
  order: 1
---

The dashboard and the CLI use the same JSON API, served by the Worker under `/api/v1`. Request and
response shapes are the Zod schemas and DTO types in `packages/shared/src` (`schemas/` and
`api.ts`); this page lists the routes. The API is pre-1.0 and may change between minor versions.

## Authentication

| Credential | How to send it | Who uses it |
|------------|----------------|-------------|
| Session (`anc_s_…`) | `__Host-anchor_session` cookie, set by `POST /auth/login` | The dashboard (7 days) |
| Session (`anc_s_…`) | `Authorization: Bearer <token>` | The CLI (30 days) |
| Service token (`anc_st_…`) | `Authorization: Bearer <token>` only | CI and servers |

When both are present, the `Authorization` header wins. A state-changing request (`POST`, `PUT`,
`PATCH`, `DELETE`) authenticated by the cookie must send an `Origin` header equal to the instance's
own origin. Service tokens can only call the secret, folder and import read/write routes in their
scopes (and read their project).

## Errors

Every error has the same body:

```json
{ "error": { "code": "forbidden", "message": "You do not have permission to perform this action" } }
```

| Code | Status | Meaning |
|------|--------|---------|
| `bad_request` | 400 | Invalid body, query or path parameter |
| `unauthenticated` | 401 | No credential, or an expired or revoked one |
| `invalid_credentials` | 401 | Wrong email or password |
| `forbidden` | 403 | Authenticated, but not allowed |
| `not_found` | 404 | No such resource (or not visible to you) |
| `conflict` | 409 | Already exists, or a concurrent write won; retry |
| `payload_too_large` | 413 | A secret value over 65,536 bytes |
| `rate_limited` | 429 | Too many failed logins; the account is locked for 15 minutes |
| `internal` | 500 | Server error, including a misconfigured root key (`config_error` in the logs) |

Messages never contain secret values.

## Routes

All paths are relative to `/api/v1`. `:project` and `:env` are slugs.

### Instance

| Method and path | Purpose |
|-----------------|---------|
| `GET /health` | Liveness: `{ "status": "ok" }`, no authentication |
| `GET /setup/status`, `POST /setup` | First-run setup: the first `POST` creates the owner, later ones get `409` |
| `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | Sessions |
| `POST /auth/password`, `POST /auth/password-reset` | Change your password; complete a reset link |
| `POST /auth/cli/start` | Start a browser login for the CLI (no session): `{ clientName? }` → `{ deviceCode, userCode, verificationUri, verificationUriComplete, expiresAt, interval }` |
| `POST /auth/cli/token` | Poll a browser login with `{ deviceCode }` (no session): `202 { status: "pending" }`, `200` with a CLI session token, `429` when polled sooner than `interval` seconds, `403` when denied, `404` when expired, unknown or already used |
| `GET /auth/cli/requests/:userCode` | A pending browser login, for the approval page (dashboard session only) |
| `POST /auth/cli/requests/:userCode/approve`, `POST …/deny` | Approve or deny it (dashboard session only, same `Origin`): `204`, or `404` when it is no longer pending |
| `GET /auth/sessions`, `DELETE /auth/sessions/:id` | List and revoke your sessions |
| `GET /users`, `PATCH /users/:id`, `DELETE /users/:id`, `POST /users/:id/password-reset` | User management (owners and admins) |
| `GET /invites`, `POST /invites`, `DELETE /invites/:id` | Invite links (owners and admins) |
| `POST /invites/inspect`, `POST /invites/accept` | Open and accept an invite link (no session) |
| `GET /audit` | Instance audit log (owners and admins), paginated with `limit` and `before` |
| `POST /admin/root-key/rewrap` | Re-wrap every project key after a root key change (owners) |

### Projects

| Method and path | Purpose |
|-----------------|---------|
| `GET /projects`, `POST /projects` | List your projects; create one (owners and admins) |
| `GET`, `PATCH`, `DELETE /projects/:project` | Read, rename, delete |
| `GET /projects/:project/overview` | Counts and recent activity for the overview page |
| `GET`, `POST /projects/:project/environments` | List and create environments |
| `PATCH`, `DELETE /projects/:project/environments/:env` | Rename and delete an environment |
| `GET`, `POST /projects/:project/members`; `PATCH`, `DELETE …/members/:userId` | Project members, roles and allowed environments |
| `GET`, `POST /projects/:project/service-tokens`; `DELETE …/service-tokens/:id` | Service tokens (the token is shown once, at creation). Create body `{ name, permission, scopes, expiresInDays }`, where `expiresInDays` is 1-365 or `null` for no expiry (required); `expiresAt` in responses is a timestamp or `null` |
| `GET /projects/:project/keys`, `POST /projects/:project/keys/rotate` | Key versions and rotation progress; start a rotation (202) |
| `GET /projects/:project/audit` | Project audit log (project admins) |

### Secrets, folders and imports

Prefix: `/projects/:project/environments/:env`.

| Method and path | Purpose |
|-----------------|---------|
| `GET /secrets?path=&reveal=&expand=&includeImports=` | List a folder; values with `reveal=true`, and always for non-sensitive secrets (stored text, not expanded) |
| `GET /secrets/:key?path=&reveal=&expand=&includeImports=` | Read one secret |
| `PUT /secrets/:key` | Create or update: `{ value, comment?, path?, type?, sensitive? }`; writing the current content (value, comment, type and flag) is a no-op |
| `DELETE /secrets/:key?path=` | Delete |
| `GET /secrets/:key/versions`, `GET /secrets/:key/versions/:version` | History (no values); one past value |
| `POST /secrets/:key/rollback` | `{ version, path? }`: restore a past version as a new one |
| `GET /folders?path=`, `POST /folders`, `DELETE /folders?path=&force=` | Folders |
| `GET /imports?path=`, `POST /imports`, `DELETE /imports/:id` | A folder's imports |

Reading values (`reveal=true`, one secret, or a past version) writes an audit event first; if that
fails, the read fails with `500`.

#### Value types and the sensitive flag

Every secret version has a `type` (`string`, `json`, `pem`, `number`, `boolean` or `list`) and a
`sensitive` flag. Both appear on every secret and version in responses. On `PUT`, an omitted
`type` or `sensitive` keeps the current version's, or defaults to `string` and `true` for a new
secret. The value is stored exactly as sent and must fit its type:

| Type | Accepted value |
|------|----------------|
| `string` | anything |
| `json` | any JSON text |
| `pem` | one or more PEM blocks (`-----BEGIN <LABEL>-----` … `-----END <LABEL>-----`) |
| `number` | a JSON number, such as `8080` or `0.5` |
| `boolean` | `true` or `false` |
| `list` | a JSON array of strings |

A value that does not fit is refused with `400 bad_request` and the message
`value is not valid for type <type>: <reason>`; the value itself is never echoed. Changing only
the type or the flag creates a new version, and a rollback restores the old version's type and
flag along with its value.

A non-sensitive secret is still encrypted at rest and readable only with `secret:read` on its
environment and folder, but a list returns its value without `reveal` and records no
`secret.read` event for it.

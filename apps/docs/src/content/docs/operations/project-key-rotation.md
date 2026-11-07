---
title: Rotate a project key
description: Re-encrypt a project's secret values under a new key, online, in the background.
sidebar:
  order: 1
---

Each project has a key (KEK) that encrypts its secret values. A project admin rotates it with
`POST /api/v1/projects/<slug>/keys/rotate` (202). That creates a new key version for new writes,
marks the old one `retiring`, and re-encrypts existing values in the background, 100 versions per
queue message. Every value stays readable throughout. `GET /api/v1/projects/<slug>/keys` shows the
key versions and the rotation progress (`done` / `total`). In the dashboard, the same controls are
on the project's **Encryption** page (project admins), which polls while a rotation runs.

- The old key becomes `retired` only when no stored version uses it any more.
- Calling rotate again while a rotation runs resumes it (re-sends its message) instead of starting
  a second one.
- A batch that keeps throwing (for example a project key that no longer unwraps) is retried with
  backoff (30 s, doubling, capped at an hour: about three hours in all); on its 10th attempt the rotation stops with status `failed` and error `retries_exhausted`, and
  `reencrypt_rotation_failed` is logged. Fix the cause, then start a new rotation. The daily Cron
  Trigger re-sends the message of any rotation still `running` but idle for 15 minutes, as does
  the next rotate call.
- A stored value that fails its integrity check stops the rotation with status `failed` and error
  `decrypt_failed`, and logs `secret_decrypt_failed` with the ids. Treat it as an incident:
  investigate, then start a new rotation.

Rotating a project key does not touch the root key. To replace the root key, see
[Rotate the root key](/anchor/operations/root-key-rotation/).

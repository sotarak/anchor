---
title: Rate limiting
description: Add a Cloudflare rate-limiting rule in front of the public auth endpoints.
sidebar:
  order: 4
---

Every failed login, including one for an email that does not exist, writes an audit row that
cannot be deleted for 365 days. Anchor itself does not rate-limit by IP yet. Without a limit,
anonymous traffic can grow the database until audit inserts fail, and because secret reads fail
closed when they cannot be audited, secret reads then fail too. Add a Cloudflare rate-limiting rule
(dashboard → Security → WAF → Rate limiting rules) for `POST /api/v1/auth/*` and
`POST /api/v1/invites/*`, for example 20 requests per minute per IP, and watch the D1 size.

Anchor does lock an account after 5 failed logins in a row, for 15 minutes. That protects the
password, not the database: requests for unknown emails, and requests during the lockout, are
still audited.

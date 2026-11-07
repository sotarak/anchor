---
title: Audit retention
description: How long audit events are kept and how the daily purge works.
sidebar:
  order: 3
---

Audit events are kept for **365 days**. The table is append-only: a database trigger rejects every
`UPDATE`, and rejects `DELETE` of any row younger than 365 days. The daily Cron Trigger deletes the
older rows and logs an `audit_purged` line with the count.

The project audit log (project admins) and the instance audit log (instance owners and admins)
are on the dashboard's **Audit** pages and at `GET /api/v1/projects/<slug>/audit` and
`GET /api/v1/audit`. An event records the actor, the action, the target, the time, the IP
address and user agent, and metadata (capped at 16,384 bytes). Events never contain secret values.

To exercise the purge locally, run `pnpm exec wrangler dev --test-scheduled` at the repository root and
request `http://localhost:8787/__scheduled?cron=0+3+*+*+*`; the console shows an `audit_purged`
line.

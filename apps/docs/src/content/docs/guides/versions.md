---
title: Versions and rollback
description: Every write keeps the previous value; read any past version and restore it.
sidebar:
  order: 5
---

Every change to a secret creates a new version. Old versions are kept, encrypted like the current
one, so you can see who changed what and put a previous value back.

## History

- **Dashboard:** open a secret's row menu and choose **History**. The sheet lists every version
  with its author, date and comment, and lets you reveal a past value.
- **CLI:** `anchor secrets history DB_URL` lists the versions (no values);
  `anchor secrets get DB_URL --at-version 3 --reveal` prints one past value (the stored value, not
  expanded).
- **API:** `GET …/secrets/:key/versions` and `GET …/secrets/:key/versions/:version`.

Reading a past value is audited (`secret.version_read`), like reading the current one.

## Rollback

Rollback restores the value and comment of a past version **as a new version**. Nothing is
deleted, so a rollback can itself be rolled back.

- **Dashboard:** **Roll back** on a version in the history sheet.
- **CLI:** `anchor secrets rollback DB_URL --to 2` (asks for confirmation; `--yes` in scripts).
- **API:** `POST …/secrets/:key/rollback` with `{ "version": 2 }`.

Rolling back to content equal to the current version is a no-op ("Already at that content").
The new version is encrypted under the project's current key, so rolling back after a
[key rotation](/anchor/operations/project-key-rotation/) does not bring the old key back into use.

Deleting a secret deletes its history too.

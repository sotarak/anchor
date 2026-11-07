---
title: References and imports
description: Reuse one secret inside another with ${...} references, and share a whole folder with imports.
sidebar:
  order: 4
---

Two features let you avoid copying the same value into many places. A **reference** puts one
secret inside another secret's value. An **import** makes the secrets of one folder appear in
another folder.

## References

A value can contain references to other secrets:

| Syntax | Refers to |
|--------|-----------|
| `${KEY}` | `KEY` in the same environment and folder |
| `${prod:/KEY}` | `KEY` in the root folder of the `prod` environment |
| `${prod:/db/PASSWORD}` | `PASSWORD` in the `/db` folder of `prod` |
| `$${` | A literal `${` |

Example: `DATABASE_URL` = `postgres://app:${prod:/db/PASSWORD}@db.internal:5432/app`.

- Anything that starts with `${` but does not match the syntax is kept as literal text.
- The stored value keeps the reference. Reads expand it only when asked: the API with
  `expand=true`; the CLI expands by default in `secrets get`, `run` and `export` (`--no-expand`
  turns it off); the dashboard shows the stored value and the resolved value side by side.
- References can point to secrets that themselves contain references, up to 5 hops. A cycle, a
  reference to a secret that does not exist, or a chain deeper than 5 is a `400` that names the
  reference. See [Limits](/anchor/reference/limits/#secrets) for the size caps.
- **Every hop is authorized.** To expand `${prod:/db/PASSWORD}` you need read access to
  `prod:/db`. If you do not have it, the read is a `403` that names the reference, whether the
  target exists or not. A service token scoped to `staging` cannot read `prod` through a
  reference.
- Changing the referenced secret changes every value that references it, on the next read.
- The audit event of a read lists the secrets its references loaded.

## Imports

An import makes a folder show the secrets of another folder, in the same or another environment
of the same project. For example, import `shared:/` into `prod:/api` so every service gets the
common values without copying them.

- Manage imports on the folder in the dashboard (**Add import**), or through the API
  (`/imports`). Creating or deleting one requires write access to the folder and read access to
  the source.
- Reads include imports only when asked: the API with `includeImports=true`; the CLI always
  includes them in `secrets get`, `run` and `export`; the dashboard lists imported secrets with an
  **Imported from** label.
- **Local secrets win.** A key defined in the folder itself hides an imported key with the same
  name. Between imports, the first one added wins.
- Imports are not followed transitively: importing a folder brings its own secrets, not the
  secrets that folder imports.
- A reference inside an imported value resolves relative to the folder it comes from.
- A listing authorizes every import: if you cannot read one source, listing the folder with
  imports is a `403` that names it. Reading one key that exists locally still works.
- Deleting an environment removes the imports that point to it.

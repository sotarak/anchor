---
title: Dashboard tour
description: A walk through the pages of the Anchor dashboard and who can see each one.
sidebar:
  order: 2
---

The dashboard is served by the same Worker as the API, at the instance's root URL. It uses the same
session and permissions as the API: a page or a button you are not allowed to use is hidden or
disabled, and the server rejects the request anyway.

## First run

- **`/setup`** appears only on a fresh instance. The first account created there becomes the owner;
  do it right after the deploy.
- **`/login`**, **`/accept-invite`** and **`/reset-password`** are the sign-in page and the
  landing pages of invite and password-reset links.

## Projects

- **Projects** (home) lists the projects you can access. Instance owners and admins can create one.
- **Project overview** summarizes the project and its environments.
- **Environment** (`/projects/<project>/environments/<env>`) is where secrets live:
  - The sidebar's environment switcher changes the environment for the whole project.
  - The table lists the secrets of the current folder in columns: Key, Value (masked), Comment,
    Version and Updated. A long comment is cut to one line; hover it to read it in full. Reveal and
    copy appear on hover. Create and edit open a side sheet.
  - The side sheet has a **Type** (`string`, `json`, `pem`, `number`, `boolean`, `list`) and a
    **Sensitive** checkbox (checked by default). The value is checked against its type before it is
    saved, and the reason (for example `not valid JSON`) shows under **Value**. A secret whose type
    is not `string` carries a type tag next to its key. Values of non-sensitive secrets are plain
    config: the table shows them as stored, without a reveal button.
  - Folders: browse with the path breadcrumb, **Create folder**, **Delete folder**.
  - Imports: **Add import** shows another folder's secrets here; imported rows carry an
    **Imported from** label. See [References and imports](/anchor/guides/references-imports/).
  - A value with references shows both the stored value and the **Resolved value**.
  - The row menu has **History** (versions, reveal a past value, **Roll back**). See
    [Versions and rollback](/anchor/guides/versions/).

## Project settings (project admins)

- **Environments**: create, rename and delete environments.
- **Members**: add instance users to the project, set their role (admin, developer, viewer) and
  the environments they may access.
- **Service tokens**: create (the token is shown once), list with last use, revoke. See
  [Use Anchor in CI](/anchor/guides/ci/).
- **Encryption**: the project key versions and rotation status; start a rotation. See
  [Rotate a project key](/anchor/operations/project-key-rotation/).

## Instance (owners and admins)

- **Users**: invite people (a link valid 72 hours), change instance roles, disable or delete
  accounts, create password-reset links. The last active owner cannot be demoted, disabled or
  deleted.
- **Audit log**: the instance audit log, filterable by project, actor and action, with each
  event's target and metadata. Project admins who are not instance admins get **Project audit
  log** in the sidebar instead, for their project.

## Account (everyone)

- Change your password.
- See your active sessions (dashboard and CLI) and revoke any of them.

## Approving a CLI login

`anchor login` opens `/cli/login?code=XXXX-XXXX` in your browser (sign in first if asked). The page
shows the code in large type, the device name the CLI sent, the IP address and how long ago the
request was made. **Only approve if you just ran anchor login and this code matches your
terminal.** **Approve** gives that terminal a CLI session as you (30 days, revocable from your
sessions list); **Deny** makes the CLI stop with "Login was denied in the browser". Either way the page then says
"You can close this tab and return to your terminal."

Opened without a code (or with a malformed one), the page asks for it; spaces, dashes and case do
not matter (`wdjb mjht` works). A code that expired after 10 minutes or was already used shows
"This login request expired or was already used." Only a dashboard session can approve; a CLI
session or service token cannot.

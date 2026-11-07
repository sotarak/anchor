---
title: Break-glass recovery
description: Recover an instance when no active owner can sign in.
sidebar:
  order: 5
---

If no active owner can sign in (for example, the only owner was disabled or forgot their password
and no other owner exists), re-enable and promote a known account directly in D1:

```sh
pnpm exec wrangler d1 execute anchor --remote \
  --command "UPDATE users SET disabled_at = NULL, role = 'owner' WHERE email = '...'"
```

Then send that person a password-reset link (dashboard **Users** page, or the API), or let them sign in if they know their
password. **This bypasses the API, so it leaves no audit event.** Record who ran it, when and why
in your own change log, and review the instance's users and audit log right after.

---
title: Rotate the root key
description: Replace the root key and re-wrap every project key without downtime.
sidebar:
  order: 2
---

The root key wraps every project key (KEK). Rotating it re-wraps those keys; secret values are
not touched. Every root key has an id, stored with each KEK it wraps: `ANCHOR_ROOT_KEY_ID`
(default `rk1`, format `^[a-z0-9-]{1,32}$`). While rotating, the old key stays configured as
`ANCHOR_ROOT_KEY_PREVIOUS` so existing data keeps working.

Each `wrangler secret put` deploys a new Worker version immediately, and the intermediate states
(a previous key without its id, or a previous id equal to the current id) fail closed: every
secret read and write would return 500 until the last variable is set. So the four variables
change together, in one `wrangler secret bulk` request.

1. Generate the new key and back it up offline (see [step 3 of the deploy guide](/anchor/guides/deploy/#3-generate-back-up-then-set-the-root-key)):
   `umask 077 && openssl rand -base64 32 > anchor-root-new.key`. Restore the current key from its
   offline backup into `anchor-root.key` (same `umask 077` shell).
2. Write the four variables to a private JSON file, set them in one request, then delete the file.
   `OLD_ID` is the current id (`rk1` if you never set one); `NEW_ID` is the new one, for example
   `rk2`:

   ```sh
   umask 077
   OLD_ID=rk1 NEW_ID=rk2 node -e '
     const fs = require("node:fs");
     const read = (f) => fs.readFileSync(f, "utf8").trim();
     process.stdout.write(JSON.stringify({
       ANCHOR_ROOT_KEY_PREVIOUS: read("anchor-root.key"),
       ANCHOR_ROOT_KEY_PREVIOUS_ID: process.env.OLD_ID,
       ANCHOR_ROOT_KEY: read("anchor-root-new.key"),
       ANCHOR_ROOT_KEY_ID: process.env.NEW_ID,
     }));' > root-rotation.json
   pnpm exec wrangler secret bulk root-rotation.json
   rm root-rotation.json anchor-root.key anchor-root-new.key
   ```

   Both keys must already be in your offline backup before the `rm`.
3. Check the deployment: `GET /api/v1/health` answers, and a secret read still works.
4. As an instance owner, re-wrap every project key:
   `curl -X POST https://<host>/api/v1/admin/root-key/rewrap -H 'authorization: Bearer <token>'`
5. Check that `rewrapped` equals the number of project key rows, then call it again and expect
   `{ "rewrapped": 0 }`.
6. Remove the previous key and its id together (a previous key left without its id fails
   closed):

   ```sh
   echo '{"ANCHOR_ROOT_KEY_PREVIOUS": null, "ANCHOR_ROOT_KEY_PREVIOUS_ID": null}' > drop.json
   pnpm exec wrangler secret bulk drop.json && rm drop.json
   ```

7. Confirm the offline backup of the new key, then destroy the old key's backups only after you
   no longer need to restore a database backup taken before step 4.

A misconfiguration fails closed with `500 internal`. A previous key without its id, or a previous
id equal to the current id, logs `config_error`. Project keys under a root key id that is not
configured log `secret_decrypt_failed` (with the `projectId` and `kekVersion`) on every read of
that project. A previous key that does not match fails the rewrap with `secret_decrypt_failed` and
writes nothing.

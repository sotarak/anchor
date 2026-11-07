import { Hono } from "hono";
import { recordAudit } from "../audit/record";
import { requireUser } from "../auth/middleware";
import { getRootKeyring, rewrapAllKeks } from "../crypto/keyring";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/errors";

/** Mounted at /api/v1/admin. Instance owners only. */
export const adminRoutes = new Hono<AppEnv>();

/** Re-wraps every project KEK under the current root key (root key rotation, see the operations docs in apps/docs). */
adminRoutes.post("/root-key/rewrap", async (c) => {
  const user = requireUser(c);
  if (user.role !== "owner") {
    throw new ApiError(403, "forbidden", "You do not have permission to perform this action");
  }
  const keyring = await getRootKeyring(c.env);
  const rewrapped = await rewrapAllKeks(c.env.DB, keyring);
  await recordAudit(c, {
    action: "root_key.rewrapped",
    metadata: { count: rewrapped, toKeyId: keyring.current.id },
  });
  return c.json<{ rewrapped: number }>({ rewrapped });
});

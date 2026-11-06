import { ApiRequestError } from "../api/http";
import { credentialStore, rawApiFor, requireApiUrl } from "../auth";
import type { CommandContext } from "../context";
import { CliError, EXIT } from "../errors";

/** Revokes the stored session on the server, then deletes it locally (even if revoking failed). */
export async function logout(ctx: CommandContext): Promise<void> {
  if (ctx.deps.io.env.ANCHOR_TOKEN) {
    ctx.out.warn("ANCHOR_TOKEN is set; logout only affects stored credentials");
  }
  const apiUrl = requireApiUrl(ctx);
  const store = await credentialStore(ctx);
  const stored = await store.get(apiUrl);
  if (!stored) {
    ctx.out.info("Not logged in");
    if (ctx.flags.json) ctx.out.data({ loggedOut: false, revoked: false }, () => "");
    return;
  }
  let revoked = true;
  try {
    await rawApiFor(ctx, apiUrl, stored.token).logout();
  } catch (e) {
    // 401: the server no longer knows this session, which is the state we want.
    if (!(e instanceof ApiRequestError && e.code === "unauthenticated")) revoked = false;
    if (!(e instanceof ApiRequestError)) throw e;
  }
  await store.delete(apiUrl);
  if (!revoked) {
    throw new CliError(
      EXIT.ERROR,
      "Removed local credentials but could not revoke the session on the server",
      `It stays valid until ${new Date(stored.expiresAt).toISOString()}`,
    );
  }
  ctx.out.info(`Logged out of ${apiUrl}`);
  if (ctx.flags.json) ctx.out.data({ loggedOut: true, revoked: true }, () => "");
}

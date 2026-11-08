import { hostname, userInfo } from "node:os";
import { normalizeUserCode } from "@anchor/shared";
import { ApiRequestError } from "../api/http";
import { rawApiFor } from "../auth";
import type { CommandContext } from "../context";
import { CliError, EXIT, toCliError } from "../errors";
import { resolveLoginTarget, saveLogin } from "./login";

const NO_BROWSER_LOGIN =
  "This server does not support browser login; use anchor login --with-password";
const DENIED = "Login was denied in the browser";
const EXPIRED = "Login request expired; run anchor login again";
const TOO_MANY_HINT = "Try again in a few minutes, or use anchor login --with-password";
const SLOW_DOWN_S = 5;

/** `<user>@<host>`, shown on the approval page so the person can recognize the request. */
function clientName(): string {
  let user = "unknown";
  try {
    user = userInfo().username;
  } catch {
    // No passwd entry (some containers): keep the placeholder.
  }
  return `${user}@${hostname()}`.slice(0, 100);
}

/**
 * Browser login (spec 2026-11-07-v0.4.0-cli-browser-login): print the URL and code, open the
 * browser when there is a terminal, then poll until the dashboard approves or denies. The device
 * code stays in memory and is never printed.
 */
export async function loginWithBrowser(
  ctx: CommandContext,
  opts: { noBrowser: boolean },
): Promise<void> {
  const { io } = ctx.deps;
  const sleep = ctx.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const { apiUrl, source } = await resolveLoginTarget(ctx, "browser");
  const api = rawApiFor(ctx, apiUrl);

  let started: Awaited<ReturnType<typeof api.cliLoginStart>>;
  try {
    started = await api.cliLoginStart({ clientName: clientName() });
  } catch (e) {
    // A 0.3.x server has no such route.
    if (e instanceof ApiRequestError && e.status === 404)
      throw new CliError(EXIT.ERROR, NO_BROWSER_LOGIN);
    if (e instanceof ApiRequestError && e.status === 429)
      throw new CliError(EXIT.ERROR, e.message, TOO_MANY_HINT, e.code);
    throw toCliError(e, { apiUrl });
  }

  // The URL is built here from the API URL the user chose and a code that must be 8 letters of
  // the code alphabet: nothing the server sends reaches the browser opener (or cmd.exe) as is.
  const userCode = normalizeUserCode(started.userCode);
  if (!userCode) throw new CliError(EXIT.ERROR, "The server returned an invalid login code");
  const url = `${new URL(apiUrl).origin}/cli/login?code=${userCode}`;
  ctx.out.notice(`Open ${url} and confirm the code ${userCode}`);
  if (!opts.noBrowser && io.stdinIsTTY && io.stderrIsTTY) await ctx.deps.openUrl?.(url);
  ctx.out.notice("Waiting for approval…");

  let interval = started.interval;
  // Expiry is the server's call (a 404): comparing its expiresAt with the local clock would fail
  // at once on a machine whose clock runs fast.
  for (;;) {
    await sleep(interval * 1000);
    try {
      const result = await api.cliLoginToken(started.deviceCode);
      if (result.status === "approved") return saveLogin(ctx, apiUrl, source, result.login);
    } catch (e) {
      if (!(e instanceof ApiRequestError)) throw e;
      if (e.status === 429) interval += SLOW_DOWN_S;
      else if (e.status === 403) throw new CliError(EXIT.AUTH, DENIED);
      else if (e.status === 404) throw new CliError(EXIT.AUTH, EXPIRED);
      else throw toCliError(e, { apiUrl });
    }
  }
}

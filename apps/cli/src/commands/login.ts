import type { LoginResponse } from "@anchor/shared";
import { ApiRequestError } from "../api/http";
import { credentialStore, rawApiFor } from "../auth";
import { normalizeApiUrl } from "../config/api-url";
import type { Source } from "../config/resolve";
import { readUserConfig, writeUserConfig } from "../config/user-config";
import type { CommandContext } from "../context";
import { CliError, EXIT, toCliError } from "../errors";
import { isInteractive, stripOneNewline } from "../interactive";
import { loginWithBrowser } from "./login-browser";

/**
 * `anchor login`: the browser flow by default; the password flow with --with-password, or when
 * --email or --password-stdin is given (so existing scripts keep working).
 */
export async function login(
  ctx: CommandContext,
  opts: { email?: string; passwordStdin?: boolean; withPassword?: boolean; browser?: boolean },
): Promise<void> {
  if (opts.withPassword || opts.email !== undefined || opts.passwordStdin) {
    return loginWithPassword(ctx, opts);
  }
  return loginWithBrowser(ctx, { noBrowser: opts.browser === false });
}

/**
 * The API URL to log in to, validated before any credential is read or any request is sent.
 * An URL that comes only from .anchor.json needs a confirmation (or --yes).
 */
export async function resolveLoginTarget(
  ctx: CommandContext,
  mode: "browser" | "password",
): Promise<{ apiUrl: string; source: LoginSource }> {
  const { prompts } = ctx.deps;
  const interactive = isInteractive(ctx);
  let apiUrl = ctx.config.apiUrl?.value;
  let source: LoginSource = ctx.config.apiUrl?.source ?? "prompt";
  if (!apiUrl) {
    if (!interactive) {
      throw new CliError(
        EXIT.USAGE,
        "No API URL configured",
        "Pass --api-url https://... or set ANCHOR_API_URL",
      );
    }
    apiUrl = normalizeApiUrl(await prompts.input({ message: "API URL" }));
    source = "prompt";
  }
  // A cloned repository's .anchor.json must not be able to collect a password unnoticed, nor
  // become the user's default server (which would make ANCHOR_TOKEN eligible for it).
  if (source === "project" && ctx.config.userApiUrl !== apiUrl) {
    ctx.out.warn(
      `.anchor.json points to ${apiUrl}, which differs from your configured ${ctx.config.userApiUrl ?? "(none)"}`,
    );
    if (!ctx.flags.yes) {
      if (!interactive) {
        throw new CliError(
          EXIT.USAGE,
          `Not logging in to ${apiUrl}: it comes only from .anchor.json`,
          `Pass --api-url ${apiUrl} (or --yes) if you trust this server`,
        );
      }
      const message =
        mode === "password" ? `Send your password to ${apiUrl}?` : `Log in to ${apiUrl}?`;
      if (!(await prompts.confirm({ message, default: false }))) {
        throw new CliError(EXIT.ERROR, "Aborted");
      }
    }
  }
  ctx.out.notice(`Logging in to ${apiUrl}`);
  return { apiUrl, source };
}

async function loginWithPassword(
  ctx: CommandContext,
  opts: { email?: string; passwordStdin?: boolean },
): Promise<void> {
  const { io, prompts } = ctx.deps;
  const interactive = isInteractive(ctx);
  const { apiUrl, source } = await resolveLoginTarget(ctx, "password");

  // Email and password. The password never comes from argv.
  let email = opts.email;
  if (!email) {
    if (!interactive) {
      throw new CliError(
        EXIT.USAGE,
        "Missing --email",
        "Pass --email <email> in non-interactive mode",
      );
    }
    email = await prompts.input({ message: "Email" });
  }
  let password: string;
  if (opts.passwordStdin) {
    password = stripOneNewline(await io.readStdin());
    if (password === "") throw new CliError(EXIT.USAGE, "No password on stdin");
  } else if (interactive) {
    password = await prompts.password({ message: "Password" });
  } else {
    throw new CliError(
      EXIT.USAGE,
      "anchor login needs a terminal",
      "Use --password-stdin, or set ANCHOR_TOKEN in CI",
    );
  }

  // Log in and store the session token.
  let res: LoginResponse;
  try {
    res = await rawApiFor(ctx, apiUrl).login(email, password);
  } catch (e) {
    if (e instanceof ApiRequestError && e.code === "invalid_credentials") {
      throw new CliError(EXIT.AUTH, "Invalid email or password");
    }
    if (e instanceof ApiRequestError && e.code === "rate_limited") {
      throw new CliError(EXIT.ERROR, "Too many failed attempts; try again later");
    }
    throw toCliError(e, { apiUrl, during: "login" });
  }
  await saveLogin(ctx, apiUrl, source, res);
}

/** Where the login's API URL came from: a resolved config source, or the interactive prompt. */
export type LoginSource = Source | "prompt";

/**
 * Stores the CLI session and reports it; the same for both login flows. An explicit --api-url
 * becomes the default server; other sources only fill an empty default, and .anchor.json never
 * does.
 */
export async function saveLogin(
  ctx: CommandContext,
  apiUrl: string,
  source: LoginSource,
  res: LoginResponse,
): Promise<void> {
  const { io } = ctx.deps;
  if (!res.token) throw new CliError(EXIT.ERROR, "The server did not return a CLI session");
  const store = await credentialStore(ctx);
  await store.set({ apiUrl, token: res.token, email: res.user.email, expiresAt: res.expiresAt });
  const userConfig = await readUserConfig(io);
  const current = userConfig.apiUrl ? normalizeApiUrl(userConfig.apiUrl) : null;
  let defaultApiUrl = current;
  if (source !== "project" && current !== apiUrl && (current === null || source === "flag")) {
    await writeUserConfig(io, { ...userConfig, apiUrl });
    if (current !== null) ctx.out.notice(`Default server changed from ${current} to ${apiUrl}`);
    defaultApiUrl = apiUrl;
  }

  ctx.out.data(
    {
      apiUrl,
      user: res.user,
      expiresAt: res.expiresAt,
      credentialStore: store.kind,
      defaultApiUrl,
    },
    () => `Logged in to ${apiUrl} as ${res.user.email}`,
  );
}

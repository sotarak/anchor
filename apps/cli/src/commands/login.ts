import type { LoginResponse } from "@anchor/shared";
import { ApiRequestError } from "../api/http";
import { credentialStore, rawApiFor } from "../auth";
import { normalizeApiUrl } from "../config/api-url";
import { readUserConfig, writeUserConfig } from "../config/user-config";
import type { CommandContext } from "../context";
import { CliError, EXIT, toCliError } from "../errors";
import { isInteractive, stripOneNewline } from "../interactive";

export async function login(
  ctx: CommandContext,
  opts: { email?: string; passwordStdin?: boolean },
): Promise<void> {
  const { io, prompts } = ctx.deps;
  const interactive = isInteractive(ctx);

  // 1. Target origin, validated before any credential is read.
  let apiUrl = ctx.config.apiUrl?.value;
  if (!apiUrl) {
    if (!interactive) {
      throw new CliError(
        EXIT.USAGE,
        "No API URL configured",
        "Pass --api-url https://... or set ANCHOR_API_URL",
      );
    }
    apiUrl = normalizeApiUrl(await prompts.input({ message: "API URL" }));
  }
  // A cloned repository's .anchor.json must not be able to collect a password unnoticed, nor
  // become the user's default server (which would make ANCHOR_TOKEN eligible for it).
  const fromProject = ctx.config.apiUrl?.source === "project";
  if (fromProject && ctx.config.userApiUrl !== apiUrl) {
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
      if (
        !(await prompts.confirm({ message: `Send your password to ${apiUrl}?`, default: false }))
      ) {
        throw new CliError(EXIT.ERROR, "Aborted");
      }
    }
  }
  ctx.out.notice(`Logging in to ${apiUrl}`);

  // 2. Email and password. The password never comes from argv.
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

  // 3. Log in and store the session token.
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
    throw toCliError(e, { apiUrl });
  }
  if (!res.token) throw new CliError(EXIT.ERROR, "The server did not return a CLI session");
  const store = await credentialStore(ctx);
  await store.set({ apiUrl, token: res.token, email: res.user.email, expiresAt: res.expiresAt });
  const userConfig = await readUserConfig(io);
  if (!userConfig.apiUrl && !fromProject) await writeUserConfig(io, { ...userConfig, apiUrl });

  ctx.out.data(
    { apiUrl, user: res.user, expiresAt: res.expiresAt, credentialStore: store.kind },
    () => `Logged in to ${apiUrl} as ${res.user.email}`,
  );
}

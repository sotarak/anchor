import { type ApiClient, createApiClient } from "./api/client";
import type { CommandContext } from "./context";
import { selectCredentialStore } from "./credentials/select";
import type { CredentialStore } from "./credentials/types";
import { CliError, EXIT, toCliError } from "./errors";
import { CLI_VERSION } from "./version";

export type AuthSource = "ANCHOR_TOKEN" | "stored";

export function userAgent(ctx: CommandContext): string {
  return `anchor-cli/${CLI_VERSION} (${ctx.deps.io.platform}-${process.arch})`;
}

/** An API client whose calls reject with ApiRequestError (callers map codes themselves). */
export function rawApiFor(ctx: CommandContext, baseUrl: string, token?: string): ApiClient {
  const opts = { baseUrl, token, debug: (line: string) => ctx.out.debug(line) };
  return ctx.deps.createApi
    ? ctx.deps.createApi(opts)
    : createApiClient({ ...opts, fetch: ctx.deps.fetch, userAgent: userAgent(ctx) });
}

/** Builds an API client; every rejected call is mapped to a CliError with an actionable message. */
export function apiFor(
  ctx: CommandContext,
  baseUrl: string,
  token?: string,
  authSource?: AuthSource,
): ApiClient {
  return new Proxy(rawApiFor(ctx, baseUrl, token), {
    get(target, prop: keyof ApiClient) {
      const fn = target[prop] as (...args: unknown[]) => Promise<unknown>;
      return async (...args: unknown[]) => {
        try {
          return await fn.apply(target, args);
        } catch (e) {
          throw toCliError(e, { apiUrl: baseUrl, authSource });
        }
      };
    },
  });
}

export function credentialStore(ctx: CommandContext): Promise<CredentialStore> {
  return ctx.deps.selectStore
    ? ctx.deps.selectStore()
    : selectCredentialStore(ctx.deps.io, { spawner: ctx.deps.spawner, out: ctx.out });
}

export function requireApiUrl(ctx: CommandContext): string {
  if (!ctx.config.apiUrl) {
    throw new CliError(
      EXIT.USAGE,
      "No API URL configured",
      "Run 'anchor login --api-url https://...' or set ANCHOR_API_URL",
    );
  }
  return ctx.config.apiUrl.value;
}

export async function resolveAuth(
  ctx: CommandContext,
  store: CredentialStore,
): Promise<{ apiUrl: string; token: string; source: AuthSource }> {
  const apiUrl = requireApiUrl(ctx);
  const envToken = ctx.deps.io.env.ANCHOR_TOKEN;
  if (envToken) {
    // A committed .anchor.json must never be able to redirect a CI token to another host.
    if (ctx.config.apiUrl?.source === "project") {
      throw new CliError(
        EXIT.USAGE,
        "ANCHOR_TOKEN is only sent to an API URL from --api-url, ANCHOR_API_URL or your user config",
        "Set ANCHOR_API_URL",
      );
    }
    return { apiUrl, token: envToken, source: "ANCHOR_TOKEN" };
  }
  const stored = await store.get(apiUrl);
  if (stored) {
    if (stored.expiresAt <= Date.now()) {
      throw new CliError(EXIT.AUTH, "Your session has expired", "Run 'anchor login'");
    }
    return { apiUrl, token: stored.token, source: "stored" };
  }
  throw new CliError(
    EXIT.AUTH,
    `Not logged in to ${apiUrl}`,
    "Run 'anchor login' or set ANCHOR_TOKEN",
  );
}

export async function authedApi(
  ctx: CommandContext,
): Promise<{ api: ApiClient; auth: { apiUrl: string; source: AuthSource } }> {
  const { apiUrl, token, source } = await resolveAuth(ctx, await credentialStore(ctx));
  return { api: apiFor(ctx, apiUrl, token, source), auth: { apiUrl, source } };
}

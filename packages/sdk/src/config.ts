import { AnchorError } from "./errors.js";
import { DEFAULT_RETRY, type RetryPolicy } from "./retry.js";
import type { AnchorEvent, ClientOptions } from "./types.js";

export const DEFAULT_TIMEOUT_MS = 10_000;

export type Config = {
  base: string;
  origin: string;
  token: string;
  fetch: typeof fetch;
  timeoutMs: number;
  retry: RetryPolicy | false;
  onEvent?: (event: AnchorEvent) => void;
};

function fromEnv(name: string): string | undefined {
  const value = typeof process === "undefined" ? undefined : process.env[name];
  return value === "" ? undefined : value;
}

export function resolveConfig(opts: ClientOptions): Config {
  const apiUrl = opts.apiUrl || fromEnv("ANCHOR_API_URL");
  if (!apiUrl) {
    throw new AnchorError(
      0,
      "config",
      "Anchor API URL is not set: pass apiUrl or set ANCHOR_API_URL",
    );
  }
  let origin: string;
  try {
    origin = new URL(apiUrl).origin;
  } catch {
    throw new AnchorError(
      0,
      "config",
      "Anchor API URL is not a valid URL (apiUrl or ANCHOR_API_URL)",
    );
  }
  const token = opts.token || fromEnv("ANCHOR_TOKEN");
  if (!token) {
    throw new AnchorError(0, "config", "Anchor token is not set: pass token or set ANCHOR_TOKEN");
  }
  const f = opts.fetch ?? globalThis.fetch;
  if (typeof f !== "function") {
    throw new AnchorError(
      0,
      "config",
      "No fetch implementation: use Node 20 or later, or pass fetch",
    );
  }
  return {
    base: apiUrl.replace(/\/+$/, ""),
    origin,
    token,
    fetch: f,
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retry: opts.retry === false ? false : { ...DEFAULT_RETRY, ...opts.retry },
    onEvent: opts.onEvent,
  };
}

/** Calls the event hook; a hook that throws never breaks a request. */
export function emitSafely(
  onEvent: ((event: AnchorEvent) => void) | undefined,
  event: AnchorEvent,
): void {
  try {
    onEvent?.(event);
  } catch {
    // The hook is the application's; its failure is not the request's.
  }
}

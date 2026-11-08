import { type CachePolicy, memoryStore } from "./cache.js";
import { AnchorError } from "./errors.js";
import { DEFAULT_RETRY, type RetryPolicy } from "./retry.js";
import type { AnchorEvent, CacheOptions, ClientOptions, RetryOptions } from "./types.js";

export const DEFAULT_TIMEOUT_MS = 10_000;

/** Hosts where plain http never leaves the machine; the CLI applies the same rule. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const INSECURE_URL =
  "Anchor API URL must use https:// (http:// only for localhost, 127.0.0.1 and [::1]); set allowInsecureHttp to override";

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
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    throw new AnchorError(
      0,
      "config",
      "Anchor API URL is not a valid URL (apiUrl or ANCHOR_API_URL)",
    );
  }
  const plainHttpAllowed = opts.allowInsecureHttp === true || LOOPBACK.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && plainHttpAllowed)) {
    throw new AnchorError(0, "config", INSECURE_URL);
  }
  const origin = url.origin;
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
    timeoutMs: timeoutOption(opts.timeoutMs),
    retry: retryPolicy(opts.retry),
    onEvent: opts.onEvent,
  };
}

type NumberRule = { min: number; integer?: boolean; infinite?: boolean };

/**
 * A numeric option: `undefined` keeps the default; anything else must be a number within the
 * rule, or the client refuses to start. A `NaN` from an unset environment variable would
 * otherwise mean endless retries or a cache that never refreshes.
 */
function numberOption(name: string, value: number | undefined, fallback: number, rule: NumberRule) {
  if (value === undefined) return fallback;
  const valid =
    typeof value === "number" &&
    !Number.isNaN(value) &&
    (rule.infinite || Number.isFinite(value)) &&
    value >= rule.min &&
    (!rule.integer || Number.isInteger(value));
  if (!valid) {
    const kind = rule.integer ? "an integer" : "a number";
    throw new AnchorError(
      0,
      "config",
      `Anchor option ${name} must be ${kind} of at least ${rule.min}`,
    );
  }
  return value;
}

const timeoutOption = (value: number | undefined) =>
  numberOption("timeoutMs", value, DEFAULT_TIMEOUT_MS, { min: 1 });

/** The retry settings with defaults filled in, or `false` when retries are off. */
export function retryPolicy(retry: RetryOptions | false | undefined): RetryPolicy | false {
  if (retry === false) return false;
  return {
    attempts: numberOption("retry.attempts", retry?.attempts, DEFAULT_RETRY.attempts, {
      min: 1,
      integer: true,
    }),
    baseDelayMs: numberOption("retry.baseDelayMs", retry?.baseDelayMs, DEFAULT_RETRY.baseDelayMs, {
      min: 0,
    }),
    maxDelayMs: numberOption("retry.maxDelayMs", retry?.maxDelayMs, DEFAULT_RETRY.maxDelayMs, {
      min: 0,
    }),
  };
}

/** Checks every numeric option once, when the client is created. */
export function validateOptions(opts: ClientOptions): void {
  timeoutOption(opts.timeoutMs);
  retryPolicy(opts.retry);
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

export const DEFAULT_TTL_MS = 60_000;

/** The cache settings with defaults filled in, or `false` when caching is off. */
export function cachePolicy(cache: CacheOptions | false | undefined): CachePolicy | false {
  if (cache === false) return false;
  return {
    ttlMs: numberOption("cache.ttlMs", cache?.ttlMs, DEFAULT_TTL_MS, { min: 0 }),
    maxStaleMs: numberOption("cache.maxStaleMs", cache?.maxStaleMs, Number.POSITIVE_INFINITY, {
      min: 0,
      infinite: true,
    }),
    store: cache?.store ?? memoryStore(),
  };
}

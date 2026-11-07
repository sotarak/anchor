/**
 * @anchor-secrets/sdk: a Node client that reads secrets from an Anchor server
 * (spec 2026-11-07-v0.4.0-sdk-nestjs). Public types are declared here and never come from
 * `@anchor/shared`, which is bundled; the declaration output is this one file.
 */
import { decodeTypedValue } from "@anchor/shared/value-decode";

/** The value type a secret declares. */
export type AnchorValueType = "string" | "json" | "pem" | "number" | "boolean" | "list";

/** A decoded secret value, as `loadSecrets` returns it. */
export type AnchorValue = string | number | boolean | unknown[] | Record<string, unknown>;

/** One secret, with its value as the server returned it (a string). */
export type AnchorSecret = {
  key: string;
  path: string;
  type: AnchorValueType;
  sensitive: boolean;
  version: number;
  value: string;
  /** Set when the secret comes from a folder this folder imports. */
  importedFrom?: { environment: string; path: string };
};

export type ClientOptions = {
  /** Base URL of the Anchor server. Defaults to `ANCHOR_API_URL`. */
  apiUrl?: string;
  /** A service token or another bearer Anchor accepts. Defaults to `ANCHOR_TOKEN`. */
  token?: string;
  /** Replaces the global `fetch`, for proxies and tests. */
  fetch?: typeof fetch;
  /** Per attempt; default 10 000 ms. */
  timeoutMs?: number;
};

export type ListQuery = {
  /** Project slug. */
  project: string;
  /** Environment slug. */
  environment: string;
  /** Folder path; default `/`. */
  path?: string;
  /** Expand `${...}` references; default `true`, like `anchor run`. */
  expand?: boolean;
  /** Add the secrets of the folder's imports; default `true`, like `anchor run`. */
  includeImports?: boolean;
};

export interface AnchorClient {
  /** The secrets of one folder, with values. */
  listSecrets(query: ListQuery): Promise<AnchorSecret[]>;
  /** The same secrets as `{ KEY: value }`, with typed values decoded. */
  loadSecrets(query: ListQuery): Promise<Record<string, AnchorValue>>;
}

/**
 * Every failure of the client. `code` is `config`, `network`, `timeout`, `bad_response`, `http_error`
 * or the API's error code (`unauthenticated`, `forbidden`, `not_found`, ...). `status` is the
 * HTTP status, or 0 when there was no response. Messages never contain tokens or values.
 */
export class AnchorError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AnchorError";
    this.status = status;
    this.code = code;
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;
/** Waits before the 2nd and 3rd attempt. */
const RETRY_DELAYS_MS = [250, 1_000];
const RETRY_STATUSES = new Set([502, 503, 504]);

type Config = {
  base: string;
  origin: string;
  token: string;
  fetch: typeof fetch;
  timeoutMs: number;
};

function fromEnv(name: string): string | undefined {
  const value = typeof process === "undefined" ? undefined : process.env[name];
  return value === "" ? undefined : value;
}

function resolveConfig(opts: ClientOptions): Config {
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
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function errorFromResponse(res: Response): Promise<AnchorError> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const error = (body as { error?: { code?: unknown; message?: unknown } } | undefined)?.error;
  if (typeof error?.code === "string" && typeof error.message === "string") {
    return new AnchorError(res.status, error.code, error.message);
  }
  return new AnchorError(res.status, "http_error", `Anchor answered HTTP ${res.status}`);
}

/** One attempt: the parsed body of a 2xx, or an AnchorError (with `retry` when worth repeating). */
async function attempt(
  cfg: Config,
  url: string,
): Promise<{ ok: true; body: unknown } | { ok: false; error: AnchorError; retry: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await cfg.fetch(url, {
      method: "GET",
      headers: { authorization: `Bearer ${cfg.token}`, accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      const error = await errorFromResponse(res);
      return { ok: false, error, retry: RETRY_STATUSES.has(res.status) };
    }
    try {
      return { ok: true, body: await res.json() };
    } catch (cause) {
      if (controller.signal.aborted) throw cause;
      const error = new AnchorError(
        res.status,
        "bad_response",
        "Anchor returned a response that is not JSON",
      );
      return { ok: false, error, retry: false };
    }
  } catch (cause) {
    if (controller.signal.aborted) {
      const error = new AnchorError(
        0,
        "timeout",
        `Anchor at ${cfg.origin} did not answer within ${cfg.timeoutMs} ms`,
      );
      return { ok: false, error, retry: true };
    }
    const reason = cause instanceof Error ? cause.message : "request failed";
    const error = new AnchorError(
      0,
      "network",
      `Could not reach Anchor at ${cfg.origin}: ${reason}`,
      {
        cause,
      },
    );
    return { ok: false, error, retry: true };
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(cfg: Config, url: string): Promise<unknown> {
  for (let i = 0; ; i++) {
    const result = await attempt(cfg, url);
    if (result.ok) return result.body;
    const delay = RETRY_DELAYS_MS[i];
    if (!result.retry || delay === undefined) throw result.error;
    await sleep(delay);
  }
}

type WireSecret = {
  key: string;
  path: string;
  type: AnchorValueType;
  sensitive: boolean;
  version: number;
  value?: string;
  importedFrom?: { environment: string; path: string };
};

function toSecret(s: WireSecret): AnchorSecret {
  if (typeof s.value !== "string") {
    throw new AnchorError(200, "bad_response", `Anchor returned ${s.key} without a value`);
  }
  const out: AnchorSecret = {
    key: s.key,
    path: s.path,
    type: s.type,
    sensitive: s.sensitive,
    version: s.version,
    value: s.value,
  };
  if (s.importedFrom) out.importedFrom = { ...s.importedFrom };
  return out;
}

function decode(s: AnchorSecret): AnchorValue {
  try {
    return decodeTypedValue(s.type, s.value) as AnchorValue;
  } catch {
    // Never echo the value: it may be sensitive.
    throw new AnchorError(200, "bad_response", `Secret ${s.key} is not valid ${s.type}`);
  }
}

export function createAnchorClient(options: ClientOptions = {}): AnchorClient {
  const listSecrets = async (q: ListQuery): Promise<AnchorSecret[]> => {
    const cfg = resolveConfig(options);
    const params = new URLSearchParams({
      path: q.path ?? "/",
      reveal: "true",
      expand: String(q.expand ?? true),
      includeImports: String(q.includeImports ?? true),
    });
    const url = `${cfg.base}/api/v1/projects/${encodeURIComponent(q.project)}/environments/${encodeURIComponent(q.environment)}/secrets?${params}`;
    const body = (await getJson(cfg, url)) as { secrets?: unknown } | null;
    if (!body || !Array.isArray(body.secrets)) {
      throw new AnchorError(200, "bad_response", "Anchor returned an unexpected response");
    }
    return (body.secrets as WireSecret[]).map(toSecret);
  };

  return {
    listSecrets,
    async loadSecrets(q) {
      const entries = new Map<string, AnchorValue>();
      for (const s of await listSecrets(q)) {
        // The server already drops imported keys a local key shadows; keep the first regardless.
        if (!entries.has(s.key)) entries.set(s.key, decode(s));
      }
      return Object.fromEntries(entries);
    },
  };
}

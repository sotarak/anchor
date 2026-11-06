import type { ApiErrorBody, ErrorCode } from "@anchor/shared";

export type ApiErrorCode = ErrorCode | "network_error" | "timeout";

/** A failed API call. `status` is 0 when no HTTP response arrived (network error, timeout). */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export interface HttpOptions {
  baseUrl: string;
  token?: string;
  fetch: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  debug?: (line: string) => void;
  userAgent: string;
}

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const RETRY_DELAYS_MS = [250, 1000];
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
// PUT of a secret is idempotent by API contract; POST/DELETE/PATCH never are retried.
const RETRYABLE_METHODS = new Set<Method>(["GET", "PUT"]);
const TLS_CODES = new Set(["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT"]);

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function causeCode(err: unknown): string | undefined {
  const cause = (err as { cause?: { code?: unknown; errors?: { code?: unknown }[] } }).cause;
  if (!cause) return undefined;
  if (typeof cause.code === "string") return cause.code;
  const inner = cause.errors?.find((e) => typeof e?.code === "string")?.code;
  return typeof inner === "string" ? inner : undefined;
}

function networkError(err: unknown, url: URL, timeoutMs: number): ApiRequestError {
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return new ApiRequestError(
      0,
      "timeout",
      `Request to ${url.origin} timed out after ${timeoutMs / 1000}s`,
    );
  }
  const code = causeCode(err);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return new ApiRequestError(0, "network_error", `Could not resolve host ${url.hostname}`);
  }
  if (code && (code.startsWith("CERT_") || TLS_CODES.has(code))) {
    return new ApiRequestError(
      0,
      "network_error",
      `TLS certificate verification failed for ${url.origin}`,
    );
  }
  return new ApiRequestError(0, "network_error", `Could not connect to ${url.origin}`);
}

function isErrorBody(x: unknown): x is ApiErrorBody {
  const error = (x as ApiErrorBody | null)?.error;
  return typeof error?.code === "string" && typeof error.message === "string";
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  return text === "" ? undefined : JSON.parse(text);
}

/**
 * One API call with timeout and bounded retries. The debug line carries only the method,
 * the path without its query string, the status and the duration: never headers or bodies.
 */
export async function request<T>(
  opts: HttpOptions,
  method: Method,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const url = new URL(path, opts.baseUrl);
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxRetries = RETRYABLE_METHODS.has(method) ? (opts.maxRetries ?? 2) : 0;
  const sleep = opts.sleep ?? defaultSleep;
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    "user-agent": opts.userAgent,
  };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;

  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    let res: Response;
    try {
      res = await opts.fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const mapped = networkError(err, url, timeoutMs);
      opts.debug?.(`${method} ${url.pathname} -> ${mapped.code} (${Date.now() - started}ms)`);
      if (mapped.code === "network_error" && attempt < maxRetries) {
        await sleep(RETRY_DELAYS_MS[attempt] ?? 1000);
        continue;
      }
      throw mapped;
    }
    opts.debug?.(`${method} ${url.pathname} -> ${res.status} (${Date.now() - started}ms)`);
    if (RETRY_STATUSES.has(res.status) && attempt < maxRetries) {
      // Release the connection; awaiting cancel() can stall on a teed body, so do not.
      res.body?.cancel().catch(() => {});
      await sleep(RETRY_DELAYS_MS[attempt] ?? 1000);
      continue;
    }
    let data: unknown;
    try {
      data = await readJson(res);
    } catch {
      throw new ApiRequestError(
        res.status,
        "internal",
        `Unexpected response from server (HTTP ${res.status})`,
      );
    }
    if (res.ok) return { status: res.status, data: data as T };
    if (isErrorBody(data)) {
      throw new ApiRequestError(res.status, data.error.code, data.error.message);
    }
    throw new ApiRequestError(
      res.status,
      "internal",
      `Unexpected response from server (HTTP ${res.status})`,
    );
  }
}

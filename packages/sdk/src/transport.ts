import type { Config } from "./config.js";
import { AnchorError, abortedError } from "./errors.js";

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

/** `Retry-After` in seconds (the only form Anchor sends), as milliseconds. */
function retryAfterMs(res: Response): number | undefined {
  if (res.status !== 429 && res.status !== 503) return undefined;
  const header = res.headers.get("retry-after")?.trim();
  if (!header || !/^\d+$/.test(header)) return undefined;
  return Number(header) * 1_000;
}

async function errorFromResponse(res: Response): Promise<AnchorError> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const options = {
    retryable: RETRYABLE_STATUSES.has(res.status),
    retryAfterMs: retryAfterMs(res),
  };
  const error = (body as { error?: { code?: unknown; message?: unknown } } | undefined)?.error;
  if (typeof error?.code === "string" && typeof error.message === "string") {
    return new AnchorError(res.status, error.code, error.message, options);
  }
  return new AnchorError(res.status, "http_error", `Anchor answered HTTP ${res.status}`, options);
}

export type JsonResponse = { status: number; etag: string | undefined; body: unknown };

/**
 * One GET: the parsed body of a 2xx (none for a 304 answering `ifNoneMatch`), or an
 * `AnchorError` whose `retryable` says whether another attempt may succeed. Aborts after
 * `cfg.timeoutMs`, or as soon as `signal` aborts.
 */
export async function fetchJson(
  cfg: Config,
  url: string,
  signal?: AbortSignal,
  ifNoneMatch?: string,
): Promise<JsonResponse> {
  if (signal?.aborted) throw abortedError();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, cfg.timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const headers: Record<string, string> = {
      authorization: `Bearer ${cfg.token}`,
      accept: "application/json",
    };
    if (ifNoneMatch) headers["if-none-match"] = ifNoneMatch;
    const res = await cfg.fetch(url, { method: "GET", headers, signal: controller.signal });
    const etag = res.headers.get("etag") ?? undefined;
    if (res.status === 304) return { status: 304, etag, body: undefined };
    if (!res.ok) throw await errorFromResponse(res);
    try {
      return { status: res.status, etag, body: await res.json() };
    } catch (cause) {
      if (controller.signal.aborted) throw cause;
      throw new AnchorError(
        res.status,
        "bad_response",
        "Anchor returned a response that is not JSON",
      );
    }
  } catch (cause) {
    if (cause instanceof AnchorError) throw cause;
    if (timedOut) {
      throw new AnchorError(
        0,
        "timeout",
        `Anchor at ${cfg.origin} did not answer within ${cfg.timeoutMs} ms`,
        { retryable: true },
      );
    }
    if (signal?.aborted) throw abortedError();
    const reason = cause instanceof Error ? cause.message : "request failed";
    throw new AnchorError(0, "network", `Could not reach Anchor at ${cfg.origin}: ${reason}`, {
      cause,
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

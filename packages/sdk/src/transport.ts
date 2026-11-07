import type { Config } from "./config.js";
import { AnchorError } from "./errors.js";

/** Waits before the 2nd and 3rd attempt. */
const RETRY_DELAYS_MS = [250, 1_000];
const RETRY_STATUSES = new Set([502, 503, 504]);

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

export async function getJson(cfg: Config, url: string): Promise<unknown> {
  for (let i = 0; ; i++) {
    const result = await attempt(cfg, url);
    if (result.ok) return result.body;
    const delay = RETRY_DELAYS_MS[i];
    if (!result.retry || delay === undefined) throw result.error;
    await sleep(delay);
  }
}

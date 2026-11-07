import { AnchorError, abortedError } from "./errors.js";
import type { AnchorEvent, RetryOptions } from "./types.js";

export type RetryPolicy = Required<RetryOptions>;

export const DEFAULT_RETRY: RetryPolicy = { attempts: 3, baseDelayMs: 250, maxDelayMs: 5_000 };

/** Full jitter, or the server's `Retry-After` when it sent one; both capped at `maxDelayMs`. */
function delayFor(error: AnchorError, attempt: number, policy: RetryPolicy): number {
  if (error.retryAfterMs !== undefined) return Math.min(error.retryAfterMs, policy.maxDelayMs);
  const cap = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  return Math.floor(Math.random() * cap);
}

/** Resolves after `ms`, or rejects with an `aborted` error as soon as `signal` aborts. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortedError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Runs `run` until it succeeds, fails with a non-retryable error, or runs out of attempts. */
export async function withRetry<T>(
  run: () => Promise<T>,
  policy: RetryPolicy | false,
  opts: { signal?: AbortSignal; emit: (event: AnchorEvent) => void },
): Promise<T> {
  const attempts = policy ? Math.max(1, policy.attempts) : 1;
  for (let attempt = 1; ; attempt++) {
    if (opts.signal?.aborted) throw abortedError();
    try {
      return await run();
    } catch (error) {
      if (!policy || !(error instanceof AnchorError) || !error.retryable || attempt >= attempts) {
        throw error;
      }
      const delayMs = delayFor(error, attempt, policy);
      opts.emit({ type: "retry", attempt, delayMs, error });
      await wait(delayMs, opts.signal);
    }
  }
}

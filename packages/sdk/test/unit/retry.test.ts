import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emitSafely, resolveConfig } from "../../src/config";
import { AnchorError } from "../../src/errors";
import { DEFAULT_RETRY, withRetry } from "../../src/retry";
import { fetchJson } from "../../src/transport";
import type { AnchorEvent, RetryOptions } from "../../src/types";

const TOKEN = "anc_st_0123456789abcdefsecrettoken";
const URL_ = "https://anchor.example.com/api/v1/x";

type Step = Response | Error | ((init: RequestInit) => Promise<Response>);

function fakeFetch(...steps: Step[]) {
  const calls: Array<{ at: number; init: RequestInit }> = [];
  const fn = async (_input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ at: Date.now(), init });
    const next = steps.length > 1 ? steps.shift() : steps[0];
    if (next instanceof Error) throw next;
    if (typeof next === "function") return next(init);
    return (next as Response).clone();
  };
  return { fetch: fn as unknown as typeof fetch, calls };
}

const status = (code: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { code: "x", message: "X" } }), { status: code, headers });
const ok = () => new Response(JSON.stringify({ secrets: [] }), { status: 200 });

function request(
  f: typeof fetch,
  opts: {
    retry?: RetryOptions | false;
    signal?: AbortSignal;
    onEvent?: (e: AnchorEvent) => void;
  } = {},
) {
  const cfg = resolveConfig({ apiUrl: "https://anchor.example.com", token: TOKEN, fetch: f });
  const policy = opts.retry === false ? false : { ...DEFAULT_RETRY, ...opts.retry };
  return withRetry(() => fetchJson(cfg, URL_, opts.signal), policy, {
    signal: opts.signal,
    emit: (e) => emitSafely(opts.onEvent, e),
  });
}

const settle = <T>(p: Promise<T>) =>
  p.then(
    (v) => v as unknown,
    (e: unknown) => e,
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("backoff", () => {
  it("waits full-jitter backoff: 125 ms then 250 ms with random 0.5", async () => {
    const f = fakeFetch(status(503));
    const start = Date.now();
    const pending = settle(request(f.fetch));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await pending).toBeInstanceOf(AnchorError);
    expect(f.calls.map((c) => c.at - start)).toEqual([0, 125, 375]);
  });

  it("caps the backoff at maxDelayMs", async () => {
    const f = fakeFetch(status(503));
    const start = Date.now();
    const pending = settle(
      request(f.fetch, { retry: { attempts: 4, baseDelayMs: 4_000, maxDelayMs: 5_000 } }),
    );
    await vi.advanceTimersByTimeAsync(20_000);
    await pending;
    const at = f.calls.map((c) => c.at - start);
    expect((at[3] ?? 0) - (at[2] ?? 0)).toBe(2_500);
  });

  it("honors Retry-After on 429, capped at maxDelayMs", async () => {
    const short = fakeFetch(status(429, { "retry-after": "2" }), ok());
    const start = Date.now();
    const a = request(short.fetch);
    await vi.advanceTimersByTimeAsync(2_000);
    await a;
    expect(short.calls.map((c) => c.at - start)).toEqual([0, 2_000]);

    const long = fakeFetch(status(429, { "retry-after": "60" }), ok());
    const start2 = Date.now();
    const b = request(long.fetch);
    await vi.advanceTimersByTimeAsync(5_000);
    await b;
    expect(long.calls.map((c) => c.at - start2)).toEqual([0, 5_000]);
  });
});

describe("what is retried", () => {
  it.each([400, 401, 403, 404, 500])("does not retry %i", async (code) => {
    const f = fakeFetch(status(code));
    const err = (await settle(request(f.fetch))) as AnchorError;
    expect(err.status).toBe(code);
    expect(err.retryable).toBe(false);
    expect(f.calls).toHaveLength(1);
  });

  it.each([429, 502, 503, 504])("retries %i", async (code) => {
    const f = fakeFetch(status(code));
    const pending = settle(request(f.fetch));
    await vi.advanceTimersByTimeAsync(1_000);
    const err = (await pending) as AnchorError;
    expect(err.retryable).toBe(true);
    expect(f.calls).toHaveLength(3);
  });

  it("retries network errors", async () => {
    const f = fakeFetch(new TypeError("fetch failed"));
    const pending = settle(request(f.fetch));
    await vi.advanceTimersByTimeAsync(1_000);
    const err = (await pending) as AnchorError;
    expect(err.code).toBe("network");
    expect(err.retryable).toBe(true);
    expect(f.calls).toHaveLength(3);
  });

  it("retries timeouts", async () => {
    const f = fakeFetch(
      (init) =>
        new Promise<Response>((_r, reject) =>
          init.signal?.addEventListener("abort", () => reject(new DOMException("x", "AbortError"))),
        ),
    );
    const pending = settle(request(f.fetch));
    await vi.advanceTimersByTimeAsync(31_000);
    const err = (await pending) as AnchorError;
    expect(err.code).toBe("timeout");
    expect(err.retryable).toBe(true);
    expect(f.calls).toHaveLength(3);
  });

  it("retry: false makes one attempt", async () => {
    const f = fakeFetch(status(503));
    await settle(request(f.fetch, { retry: false }));
    expect(f.calls).toHaveLength(1);
  });
});

describe("cancellation", () => {
  it("stops at once when the caller aborts during a wait", async () => {
    const f = fakeFetch(status(503));
    const controller = new AbortController();
    const pending = settle(request(f.fetch, { signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(50);
    controller.abort();
    const err = (await pending) as AnchorError;
    expect(err.code).toBe("aborted");
    expect(err.retryable).toBe(false);
    expect(f.calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts an in-flight request when the caller aborts", async () => {
    let seen: AbortSignal | undefined;
    const f = fakeFetch(
      (init) =>
        new Promise<Response>((_r, reject) => {
          seen = init.signal ?? undefined;
          seen?.addEventListener("abort", () => reject(new DOMException("x", "AbortError")));
        }),
    );
    const controller = new AbortController();
    const pending = settle(request(f.fetch, { signal: controller.signal }));
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    const err = (await pending) as AnchorError;
    expect(seen?.aborted).toBe(true);
    expect(err.code).toBe("aborted");
    expect(f.calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start when the signal is already aborted", async () => {
    const f = fakeFetch(ok());
    const err = (await settle(request(f.fetch, { signal: AbortSignal.abort() }))) as AnchorError;
    expect(err.code).toBe("aborted");
    expect(f.calls).toHaveLength(0);
  });
});

describe("events", () => {
  it("emits a retry event per wait without the token", async () => {
    const events: AnchorEvent[] = [];
    const f = fakeFetch(status(503));
    const pending = settle(request(f.fetch, { onEvent: (e) => events.push(e) }));
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(events.map((e) => e.type === "retry" && [e.attempt, e.delayMs])).toEqual([
      [1, 125],
      [2, 250],
    ]);
    expect(JSON.stringify(events)).not.toContain(TOKEN);
  });

  it("an onEvent hook that throws does not break the request", async () => {
    const f = fakeFetch(status(503), ok());
    const pending = request(f.fetch, {
      onEvent: () => {
        throw new Error("hook failed");
      },
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await pending).body).toEqual({ secrets: [] });
  });
});

describe("aborts raised by the onEvent hook", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("an abort raised inside onEvent stops the wait at once", async () => {
    const controller = new AbortController();
    let runs = 0;
    const pending = withRetry(
      async () => {
        runs++;
        throw new AnchorError(503, "unavailable", "Busy", { retryable: true });
      },
      { attempts: 3, baseDelayMs: 1_000, maxDelayMs: 1_000 },
      { signal: controller.signal, emit: () => controller.abort() },
    ).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0);
    const settled = await Promise.race([pending, Promise.resolve("still waiting")]);
    expect(settled).toMatchObject({ code: "aborted" });
    expect(runs).toBe(1);
  });
});

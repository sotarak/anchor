import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AnchorEvent, createAnchorClient } from "../../src/index";

const TOKEN = "anc_st_0123456789abcdefsecrettoken";
const QUERY = { project: "zepo", environment: "prod", path: "/" };
const TTL = 60_000;

const body = (value: string) =>
  new Response(
    JSON.stringify({
      secrets: [
        { key: "A", path: "/", type: "string", sensitive: true, version: 1, value },
        { key: "N", path: "/", type: "number", sensitive: false, version: 1, value: "42" },
      ],
    }),
    { status: 200 },
  );
const unavailable = () =>
  new Response(JSON.stringify({ error: { code: "unavailable", message: "Busy" } }), {
    status: 503,
  });

function server() {
  let next: () => Response = () => body("v1");
  let calls = 0;
  const fetch = (async () => {
    calls++;
    return next();
  }) as unknown as typeof globalThis.fetch;
  return {
    fetch,
    calls: () => calls,
    serve: (make: () => Response) => {
      next = make;
    },
  };
}

function client(s: ReturnType<typeof server>, extra: object = {}) {
  return createAnchorClient({
    apiUrl: "https://anchor.example.com",
    token: TOKEN,
    fetch: s.fetch,
    retry: false,
    ...extra,
  });
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("AnchorFolder", () => {
  it("loads once and reads synchronously", async () => {
    const s = server();
    const folder = await client(s).folder(QUERY);
    expect(folder.get("A")).toBe("v1");
    expect(folder.get<number>("N")).toBe(42);
    expect(folder.get("MISSING")).toBeUndefined();
    expect(folder.has("A")).toBe(true);
    expect(folder.has("toString")).toBe(false);
    expect(folder.keys()).toEqual(["A", "N"]);
    expect(folder.toObject()).toEqual({ A: "v1", N: 42 });
    expect(s.calls()).toBe(1);
  });

  it("getOrThrow names the missing key", async () => {
    const folder = await client(server()).folder(QUERY);
    expect(folder.getOrThrow("A")).toBe("v1");
    expect(() => folder.getOrThrow("MISSING")).toThrow("Anchor secret MISSING is not set");
  });

  it("a read after ttl returns current values and refreshes in the background", async () => {
    const s = server();
    const folder = await client(s).folder(QUERY);
    s.serve(() => body("v2"));
    await vi.advanceTimersByTimeAsync(TTL);
    expect(folder.get("A")).toBe("v1");
    await flush();
    expect(s.calls()).toBe(2);
    expect(folder.get("A")).toBe("v2");
  });

  it("several stale reads start one refresh", async () => {
    const s = server();
    const folder = await client(s).folder(QUERY);
    await vi.advanceTimersByTimeAsync(TTL);
    for (let i = 0; i < 10; i++) folder.get("A");
    await flush();
    expect(s.calls()).toBe(2);
  });

  it("a failed background refresh keeps values and only emits", async () => {
    const events: AnchorEvent[] = [];
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const s = server();
      const folder = await client(s, { onEvent: (e: AnchorEvent) => events.push(e) }).folder(QUERY);
      s.serve(unavailable);
      await vi.advanceTimersByTimeAsync(TTL);
      expect(folder.get("A")).toBe("v1");
      await flush();
      expect(folder.get("A")).toBe("v1");
      expect(events.map((e) => e.type)).toEqual(["refresh_failed"]);
      // No second request until another ttl has passed.
      folder.get("A");
      await flush();
      expect(s.calls()).toBe(2);
      await vi.advanceTimersByTimeAsync(TTL);
      folder.get("A");
      await flush();
      expect(s.calls()).toBe(3);
      await vi.advanceTimersByTimeAsync(0);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("a failed background refresh without a cache also only emits", async () => {
    const events: AnchorEvent[] = [];
    const s = server();
    const folder = await client(s, {
      cache: false,
      onEvent: (e: AnchorEvent) => events.push(e),
    }).folder(QUERY);
    s.serve(unavailable);
    await vi.advanceTimersByTimeAsync(TTL);
    folder.get("A");
    await flush();
    expect(folder.get("A")).toBe("v1");
    expect(events.map((e) => e.type)).toEqual(["refresh_failed"]);
    folder.get("A");
    await flush();
    expect(s.calls()).toBe(2);
  });

  it("refresh() fetches now and updates the values", async () => {
    const s = server();
    const folder = await client(s).folder(QUERY);
    s.serve(() => body("v2"));
    await folder.refresh();
    expect(s.calls()).toBe(2);
    expect(folder.get("A")).toBe("v2");
  });

  it("refresh() rejects on failure and keeps the old values", async () => {
    const s = server();
    const folder = await client(s).folder(QUERY);
    s.serve(unavailable);
    await expect(folder.refresh()).rejects.toMatchObject({ status: 503 });
    expect(folder.get("A")).toBe("v1");
  });

  it("leaves no timers between reads", async () => {
    const s = server();
    const folder = await client(s).folder(QUERY);
    expect(vi.getTimerCount()).toBe(0);
    await folder.refresh();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("toObject() is frozen and decoded once per fetch", async () => {
    const s = server();
    const folder = await client(s).folder(QUERY);
    const first = folder.toObject();
    expect(Object.isFrozen(first)).toBe(true);
    expect(folder.toObject()).toBe(first);
    s.serve(() => body("v2"));
    await folder.refresh();
    expect(folder.toObject()).not.toBe(first);
  });

  it("folder() rejects when the first load fails", async () => {
    const s = server();
    s.serve(
      () =>
        new Response(JSON.stringify({ error: { code: "unauthenticated", message: "No" } }), {
          status: 401,
        }),
    );
    await expect(client(s).folder(QUERY)).rejects.toMatchObject({ status: 401 });
  });

  it("stops serving values once a refresh fails past ttl + maxStaleMs", async () => {
    const s = server();
    const folder = await client(s, { cache: { ttlMs: 1_000, maxStaleMs: 1_000 } }).folder(QUERY);
    s.serve(unavailable);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(folder.get("A")).toBe("v1");
    await flush();
    expect(folder.get("A")).toBe("v1");
    await vi.advanceTimersByTimeAsync(1_001);
    expect(folder.get("A")).toBe("v1");
    await flush();
    expect(() => folder.get("A")).toThrow(expect.objectContaining({ code: "stale" }));
    expect(() => folder.getOrThrow("A")).toThrow(expect.objectContaining({ code: "stale" }));
    s.serve(() => body("v2"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(() => folder.get("A")).toThrow(expect.objectContaining({ code: "stale" }));
    await flush();
    expect(folder.get("A")).toBe("v2");
  });

  it("serves old values forever by default", async () => {
    const s = server();
    const folder = await client(s).folder(QUERY);
    s.serve(unavailable);
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(TTL * 10);
      expect(folder.get("A")).toBe("v1");
      await flush();
    }
    expect(folder.get("A")).toBe("v1");
  });
});

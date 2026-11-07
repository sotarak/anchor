import { beforeEach, describe, expect, it } from "vitest";
import {
  type CacheEntry,
  type CacheStore,
  cacheKey,
  memoryStore,
  SecretCache,
} from "../../src/cache";
import { AnchorError } from "../../src/errors";
import type { AnchorEvent, AnchorSecret } from "../../src/types";

const TTL = 60_000;
const API = "https://anchor.example.com";
const Q = { project: "zepo", environment: "prod", path: "/", expand: true, includeImports: true };
const secret = (value: string): AnchorSecret => ({
  key: "A",
  path: "/",
  type: "string",
  sensitive: true,
  version: 1,
  value,
});

let t: number;
let events: AnchorEvent[];
beforeEach(() => {
  t = 1_000_000;
  events = [];
});

function setup(opts: { maxStaleMs?: number; store?: CacheStore } = {}) {
  const cache = new SecretCache(
    {
      ttlMs: TTL,
      maxStaleMs: opts.maxStaleMs ?? Number.POSITIVE_INFINITY,
      store: opts.store ?? memoryStore(),
    },
    (e) => events.push(e),
    () => t,
  );
  let calls = 0;
  let next: () => Promise<AnchorSecret[]> = async () => [secret(`v${calls}`)];
  const fetch = () => {
    calls++;
    return next();
  };
  return {
    cache,
    load: (o?: { fresh?: boolean; signal?: AbortSignal }) => cache.load("k", fetch, o),
    calls: () => calls,
    fail: (error = new AnchorError(503, "unavailable", "Busy", { retryable: true })) => {
      next = async () => {
        throw error;
      };
    },
    succeed: () => {
      next = async () => [secret(`v${calls}`)];
    },
  };
}

describe("freshness", () => {
  it("serves a fresh entry without fetching", async () => {
    const c = setup();
    await c.load();
    t += TTL - 1;
    expect((await c.load()).secrets[0]?.value).toBe("v1");
    expect(c.calls()).toBe(1);
  });

  it("refetches after ttl", async () => {
    const c = setup();
    await c.load();
    t += TTL;
    expect((await c.load()).secrets[0]?.value).toBe("v2");
    expect(c.calls()).toBe(2);
  });

  it("coalesces 50 concurrent loads into one fetch", async () => {
    const c = setup();
    const entries = await Promise.all(Array.from({ length: 50 }, () => c.load()));
    expect(c.calls()).toBe(1);
    expect(new Set(entries).size).toBe(1);
  });

  it("fresh: true fetches even within ttl", async () => {
    const c = setup();
    await c.load();
    await c.load({ fresh: true });
    expect(c.calls()).toBe(2);
  });
});

describe("stale fallback", () => {
  it("serves the stale entry when a refresh fails and emits refresh_failed", async () => {
    const c = setup();
    await c.load();
    t += TTL + 1_000;
    c.fail();
    expect((await c.load()).secrets[0]?.value).toBe("v1");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "refresh_failed", staleForMs: 1_000 });
    expect((events[0] as { error: AnchorError }).error.status).toBe(503);
  });

  it("keeps serving stale on 401 during a refresh", async () => {
    const c = setup();
    await c.load();
    t += TTL;
    c.fail(new AnchorError(401, "unauthenticated", "Token revoked"));
    expect((await c.load()).secrets[0]?.value).toBe("v1");
    expect(events[0]?.type).toBe("refresh_failed");
  });

  it("throws when there is no entry to fall back on", async () => {
    const c = setup();
    c.fail(new AnchorError(401, "unauthenticated", "Token revoked"));
    await expect(c.load()).rejects.toMatchObject({ status: 401 });
    expect(events).toEqual([]);
  });

  it("waits one ttl before retrying after a failed refresh", async () => {
    const c = setup();
    await c.load();
    t += TTL;
    c.fail();
    await c.load();
    expect(c.calls()).toBe(2);
    c.succeed();
    t += TTL / 2;
    expect((await c.load()).secrets[0]?.value).toBe("v1");
    expect(c.calls()).toBe(2);
    t += TTL / 2;
    expect((await c.load()).secrets[0]?.value).toBe("v3");
    expect(c.calls()).toBe(3);
  });

  it("fresh: true skips the cooldown but still falls back", async () => {
    const c = setup();
    await c.load();
    t += TTL;
    c.fail();
    await c.load();
    expect((await c.load({ fresh: true })).secrets[0]?.value).toBe("v1");
    expect(c.calls()).toBe(3);
  });

  it("drops entries older than ttl + maxStaleMs", async () => {
    const c = setup({ maxStaleMs: 5_000 });
    await c.load();
    t += TTL + 6_000;
    c.fail();
    await expect(c.load()).rejects.toMatchObject({ status: 503 });
  });

  it("does not fall back on an error that is not an AnchorError", async () => {
    const c = setup();
    await c.load();
    t += TTL;
    c.fail(new TypeError("bug") as unknown as AnchorError);
    await expect(c.load()).rejects.toBeInstanceOf(TypeError);
  });
});

describe("cancellation", () => {
  it("an aborted caller does not cancel the shared fetch for others", async () => {
    let release!: (s: AnchorSecret[]) => void;
    const c2 = new SecretCache(
      { ttlMs: TTL, maxStaleMs: Number.POSITIVE_INFINITY, store: memoryStore() },
      () => {},
      () => t,
    );
    const slow = () => new Promise<AnchorSecret[]>((r) => (release = r));
    const controller = new AbortController();
    const first = c2.load("k", slow, { signal: controller.signal });
    const second = c2.load("k", slow);
    controller.abort();
    await expect(first).rejects.toMatchObject({ code: "aborted" });
    release([secret("shared")]);
    expect((await second).secrets[0]?.value).toBe("shared");
  });
});

describe("keys and stores", () => {
  it("never shares entries between tokens", async () => {
    const k1 = await cacheKey(API, "anc_st_one", Q);
    const k2 = await cacheKey(API, "anc_st_two", Q);
    expect(k1).not.toBe(k2);
    expect(k1).not.toContain("anc_st_one");
    expect(k1).toBe(await cacheKey(API, "anc_st_one", Q));
  });

  it("separates folders, environments and flags", async () => {
    const base = await cacheKey(API, "t", Q);
    for (const q of [
      { ...Q, path: "/api" },
      { ...Q, environment: "dev" },
      { ...Q, expand: false },
      { ...Q, includeImports: false },
    ]) {
      expect(await cacheKey(API, "t", q)).not.toBe(base);
    }
  });

  it("works with an async store", async () => {
    const map = new Map<string, CacheEntry>();
    const store: CacheStore = {
      get: async (k) => map.get(k),
      set: async (k, e) => {
        map.set(k, e);
      },
    };
    const c = setup({ store });
    await c.load();
    await c.load();
    expect(c.calls()).toBe(1);
    expect(map.size).toBe(1);
  });
});

describe("a failing store", () => {
  const broken = (fail: "get" | "set"): CacheStore => {
    const map = new Map<string, CacheEntry>();
    return {
      get: async (k) => {
        if (fail === "get") throw new Error("redis down");
        return map.get(k);
      },
      set: async (k, e) => {
        if (fail === "set") throw new Error("redis down");
        map.set(k, e);
      },
    };
  };

  it("treats a get failure as a miss and still fetches", async () => {
    const c = setup({ store: broken("get") });
    expect((await c.load()).secrets[0]?.value).toBe("v1");
    expect(events).toMatchObject([{ type: "store_failed", operation: "get" }]);
  });

  it("returns the fetched values when set fails", async () => {
    const c = setup({ store: broken("set") });
    expect((await c.load()).secrets[0]?.value).toBe("v1");
    expect(events).toMatchObject([{ type: "store_failed", operation: "set" }]);
  });
});

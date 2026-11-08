import { beforeEach, describe, expect, it } from "vitest";
import {
  type CacheEntry,
  type CacheStore,
  cacheKey,
  type Fetched,
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
  const fetch = async () => {
    calls++;
    return { secrets: await next() };
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
    let release!: (f: Fetched) => void;
    const c2 = new SecretCache(
      { ttlMs: TTL, maxStaleMs: Number.POSITIVE_INFINITY, store: memoryStore() },
      () => {},
      () => t,
    );
    const slow = () => new Promise<Fetched>((r) => (release = r));
    const controller = new AbortController();
    const first = c2.load("k", slow, { signal: controller.signal });
    const second = c2.load("k", slow);
    controller.abort();
    await expect(first).rejects.toMatchObject({ code: "aborted" });
    release({ secrets: [secret("shared")] });
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

describe("slow stores", () => {
  /** A store whose get() calls are answered by the test, in call order. */
  function slowStore() {
    const entries = new Map<string, CacheEntry>();
    const gets: Array<(entry: CacheEntry | undefined) => void> = [];
    const store: CacheStore = {
      get: () => new Promise((resolve) => gets.push(resolve)),
      set: (k, e) => {
        entries.set(k, e);
      },
    };
    return { store, entries, answer: (i: number, e?: CacheEntry) => gets[i]?.(e), gets };
  }
  const deferred = <T>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("a caller arriving during a fetch joins it without waiting for the store", async () => {
    const s = slowStore();
    const cache = new SecretCache(
      { ttlMs: TTL, maxStaleMs: TTL, store: s.store },
      () => {},
      () => t,
    );
    const response = deferred<Fetched>();
    let calls = 0;
    const fetch = () => {
      calls++;
      return response.promise;
    };
    const a = cache.load("k", fetch);
    s.answer(0, undefined); // A's store read: a miss, so A starts the fetch
    await tick();
    let bDone = false;
    const b = cache.load("k", fetch).then((e) => {
      bDone = true;
      return e;
    });
    response.resolve({ secrets: [secret("v1")] });
    await tick();
    expect(bDone).toBe(true); // B never waited on its own (unanswered) store read
    expect((await a).secrets[0]?.value).toBe("v1");
    expect((await b).secrets[0]?.value).toBe("v1");
    expect(calls).toBe(1);
  });

  it("a slow store read that returns an older entry does not start a second fetch", async () => {
    const s = slowStore();
    const cache = new SecretCache(
      { ttlMs: TTL, maxStaleMs: TTL, store: s.store },
      () => {},
      () => t,
    );
    let calls = 0;
    const fetch = async () => {
      calls++;
      return { secrets: [secret(`v${calls}`)] };
    };
    const old: CacheEntry = { secrets: [secret("v0")], fetchedAt: t - TTL };
    const b = cache.load("k", fetch); // B's read starts first and stays slow
    const a = cache.load("k", fetch);
    s.answer(1, old); // A reads the stale entry and refreshes it
    expect((await a).secrets[0]?.value).toBe("v1");
    s.answer(0, old); // B's read finally answers with the entry from before A's write
    expect((await b).secrets[0]?.value).toBe("v1");
    expect(calls).toBe(1);
  });
});

describe("conditional requests", () => {
  const cacheWith = (store: CacheStore) =>
    new SecretCache(
      { ttlMs: TTL, maxStaleMs: TTL, store },
      (e) => events.push(e),
      () => t,
    );

  it("an entry stored without etag (0.4.0) refreshes with a plain request", async () => {
    const store = memoryStore();
    store.set("k", { secrets: [secret("v0")], fetchedAt: t - TTL });
    const tags: Array<string | undefined> = [];
    const entry = await cacheWith(store).load("k", async (_signal, etag) => {
      tags.push(etag);
      return { secrets: [secret("v1")], etag: '"t1"' };
    });
    expect(tags).toEqual([undefined]);
    expect(entry).toEqual({ secrets: [secret("v1")], fetchedAt: t, etag: '"t1"' });
  });

  it("unchanged keeps the secrets array, renews fetchedAt and writes the store", async () => {
    const store = memoryStore();
    const secrets = [secret("v0")];
    store.set("k", { secrets, fetchedAt: t - TTL, etag: '"t0"' });
    const tags: Array<string | undefined> = [];
    const entry = await cacheWith(store).load("k", async (_signal, etag) => {
      tags.push(etag);
      return "unchanged";
    });
    expect(tags).toEqual(['"t0"']);
    expect(entry.secrets).toBe(secrets);
    expect(entry).toEqual({ secrets, fetchedAt: t, etag: '"t0"' });
    expect(await store.get("k")).toEqual(entry);
  });

  it("fresh: true still sends the stored tag", async () => {
    const store = memoryStore();
    store.set("k", { secrets: [secret("v0")], fetchedAt: t, etag: '"t0"' });
    const tags: Array<string | undefined> = [];
    await cacheWith(store).load(
      "k",
      async (_signal, etag) => {
        tags.push(etag);
        return "unchanged";
      },
      { fresh: true },
    );
    expect(tags).toEqual(['"t0"']);
  });

  it("unchanged without a stored entry is a bad_response", async () => {
    const error = await cacheWith(memoryStore())
      .load("k", async () => "unchanged")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AnchorError);
    expect(error).toMatchObject({
      status: 304,
      code: "bad_response",
      message: "Anchor answered 304 to a request without a tag",
    });
  });
});

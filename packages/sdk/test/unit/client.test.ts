import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnchorError, createAnchorClient } from "../../src/index";

const TOKEN = "anc_st_0123456789abcdefsecrettoken";
const API = "https://anchor.example.com";
const QUERY = { project: "zepo", environment: "prod", path: "/shared" };

type Call = { url: string; init: RequestInit; at: number };

function fakeFetch(...responses: Array<Response | Error | (() => Promise<Response>)>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {}, at: Date.now() });
    const next = responses.length > 1 ? responses.shift() : responses[0];
    if (next instanceof Error) throw next;
    if (typeof next === "function") return next();
    return (next as Response).clone();
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const secret = (key: string, type: string, value: string, extra: object = {}) => ({
  key,
  path: "/shared",
  version: 1,
  comment: "",
  updatedAt: 0,
  type,
  sensitive: true,
  value,
  ...extra,
});

const client = (f: typeof fetch, extra: object = {}) =>
  createAnchorClient({ apiUrl: API, token: TOKEN, fetch: f, ...extra });

describe("request", () => {
  it("lists a folder with reveal, expand and imports", async () => {
    const f = fakeFetch(json({ secrets: [] }));
    await client(f.fetch).listSecrets(QUERY);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.url).toBe(
      `${API}/api/v1/projects/zepo/environments/prod/secrets?path=%2Fshared&reveal=true&expand=true&includeImports=true`,
    );
    const headers = new Headers(f.calls[0]?.init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(f.calls[0]?.init.method ?? "GET").toBe("GET");
  });

  it("defaults the path to / and passes expand and includeImports when turned off", async () => {
    const f = fakeFetch(json({ secrets: [] }));
    await client(f.fetch).listSecrets({
      project: "zepo",
      environment: "prod",
      expand: false,
      includeImports: false,
    });
    expect(f.calls[0]?.url).toBe(
      `${API}/api/v1/projects/zepo/environments/prod/secrets?path=%2F&reveal=true&expand=false&includeImports=false`,
    );
  });

  it("ignores a trailing slash on the API URL", async () => {
    const f = fakeFetch(json({ secrets: [] }));
    await createAnchorClient({ apiUrl: `${API}/`, token: TOKEN, fetch: f.fetch }).listSecrets(
      QUERY,
    );
    expect(f.calls[0]?.url.startsWith(`${API}/api/v1/`)).toBe(true);
  });

  describe("environment fallbacks", () => {
    beforeEach(() => {
      vi.stubEnv("ANCHOR_API_URL", "https://env.example.com");
      vi.stubEnv("ANCHOR_TOKEN", "anc_st_fromenv");
    });
    afterEach(() => vi.unstubAllEnvs());

    it("reads ANCHOR_API_URL and ANCHOR_TOKEN", async () => {
      const f = fakeFetch(json({ secrets: [] }));
      await createAnchorClient({ fetch: f.fetch }).listSecrets(QUERY);
      expect(f.calls[0]?.url.startsWith("https://env.example.com/api/v1/")).toBe(true);
      expect(new Headers(f.calls[0]?.init.headers).get("authorization")).toBe(
        "Bearer anc_st_fromenv",
      );
    });

    it("prefers options over the environment", async () => {
      const f = fakeFetch(json({ secrets: [] }));
      await client(f.fetch).listSecrets(QUERY);
      expect(f.calls[0]?.url.startsWith(`${API}/api/v1/`)).toBe(true);
    });
  });

  describe("missing configuration", () => {
    beforeEach(() => {
      vi.stubEnv("ANCHOR_API_URL", "");
      vi.stubEnv("ANCHOR_TOKEN", "");
    });
    afterEach(() => vi.unstubAllEnvs());

    it("throws a config error without a URL and makes no request", async () => {
      const f = fakeFetch(json({ secrets: [] }));
      const err = await createAnchorClient({ token: TOKEN, fetch: f.fetch })
        .listSecrets(QUERY)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AnchorError);
      expect((err as AnchorError).code).toBe("config");
      expect((err as AnchorError).message).toMatch(/ANCHOR_API_URL/);
      expect(f.calls).toHaveLength(0);
    });

    it("throws a config error without a token and makes no request", async () => {
      const f = fakeFetch(json({ secrets: [] }));
      const err = await createAnchorClient({ apiUrl: API, fetch: f.fetch })
        .listSecrets(QUERY)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AnchorError);
      expect((err as AnchorError).code).toBe("config");
      expect((err as AnchorError).message).toMatch(/ANCHOR_TOKEN/);
      expect(f.calls).toHaveLength(0);
    });
  });
});

describe("listSecrets", () => {
  it("returns the public shape, without server-only fields", async () => {
    const f = fakeFetch(
      json({
        secrets: [
          secret("DB_URL", "string", "postgres://x", { rawValue: "postgres://${P}" }),
          secret("FLAG", "boolean", "true", {
            sensitive: false,
            importedFrom: { environment: "prod", path: "/common" },
          }),
        ],
      }),
    );
    expect(await client(f.fetch).listSecrets(QUERY)).toEqual([
      {
        key: "DB_URL",
        path: "/shared",
        type: "string",
        sensitive: true,
        version: 1,
        value: "postgres://x",
      },
      {
        key: "FLAG",
        path: "/shared",
        type: "boolean",
        sensitive: false,
        version: 1,
        value: "true",
        importedFrom: { environment: "prod", path: "/common" },
      },
    ]);
  });
});

describe("loadSecrets", () => {
  it("decodes number, boolean, list and json, and keeps pem and string", async () => {
    const pem = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----";
    const f = fakeFetch(
      json({
        secrets: [
          secret("PORT", "number", "8080"),
          secret("DEBUG", "boolean", "false"),
          secret("HOSTS", "list", '["a","b"]'),
          secret("LIMITS", "json", '{"rps":10}'),
          secret("CERT", "pem", pem),
          secret("NAME", "string", "42"),
        ],
      }),
    );
    expect(await client(f.fetch).loadSecrets(QUERY)).toEqual({
      PORT: 8080,
      DEBUG: false,
      HOSTS: ["a", "b"],
      LIMITS: { rps: 10 },
      CERT: pem,
      NAME: "42",
    });
  });
});

describe("errors", () => {
  it("turns a 401 into AnchorError(401, unauthenticated) without the token", async () => {
    const f = fakeFetch(
      json({ error: { code: "unauthenticated", message: "Authentication required" } }, 401),
    );
    const err = (await client(f.fetch)
      .listSecrets(QUERY)
      .catch((e: unknown) => e)) as AnchorError;
    expect(err).toBeInstanceOf(AnchorError);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(401);
    expect(err.code).toBe("unauthenticated");
    expect(err.message).toContain("Authentication required");
    expect(err.message).not.toContain(TOKEN);
    expect(String(err)).not.toContain(TOKEN);
    expect(JSON.stringify(err)).not.toContain(TOKEN);
    expect(f.calls).toHaveLength(1);
  });

  it("does not retry a 400", async () => {
    const f = fakeFetch(json({ error: { code: "bad_request", message: "Bad path" } }, 400));
    const err = (await client(f.fetch)
      .listSecrets(QUERY)
      .catch((e: unknown) => e)) as AnchorError;
    expect(err.status).toBe(400);
    expect(err.code).toBe("bad_request");
    expect(f.calls).toHaveLength(1);
  });

  it("names a non-JSON error response by its status", async () => {
    const f = fakeFetch(new Response("<html>nope</html>", { status: 404 }));
    const err = (await client(f.fetch)
      .listSecrets(QUERY)
      .catch((e: unknown) => e)) as AnchorError;
    expect(err.status).toBe(404);
    expect(err.code).toBe("http_error");
    expect(err.message).toContain("404");
  });
});

describe("retries", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fails after exactly 3 attempts on 503, waiting 250 ms then 1 s", async () => {
    const f = fakeFetch(json({ error: { code: "unavailable", message: "Busy" } }, 503));
    const start = Date.now();
    const pending = client(f.fetch)
      .listSecrets(QUERY)
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(249);
    expect(f.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(999);
    expect(f.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(5_000);
    const err = (await pending) as AnchorError;
    expect(err).toBeInstanceOf(AnchorError);
    expect(err.status).toBe(503);
    expect(f.calls.map((c) => c.at - start)).toEqual([0, 250, 1250]);
    expect(f.calls).toHaveLength(3);
  });

  it("retries a network error and succeeds", async () => {
    const f = fakeFetch(new TypeError("fetch failed"), json({ secrets: [] }));
    const pending = client(f.fetch).listSecrets(QUERY);
    await vi.advanceTimersByTimeAsync(250);
    expect(await pending).toEqual([]);
    expect(f.calls).toHaveLength(2);
  });

  it("gives up on network errors with code network, without the token", async () => {
    const f = fakeFetch(new TypeError("fetch failed"));
    const pending = client(f.fetch)
      .listSecrets(QUERY)
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(2_000);
    const err = (await pending) as AnchorError;
    expect(err.code).toBe("network");
    expect(err.status).toBe(0);
    expect(err.message).toContain("anchor.example.com");
    expect(String(err)).not.toContain(TOKEN);
    expect(f.calls).toHaveLength(3);
  });

  it("aborts a request that takes too long and throws code timeout", async () => {
    const signals: AbortSignal[] = [];
    const hang = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal as AbortSignal;
          signals.push(signal);
          signal.addEventListener("abort", () =>
            reject(new DOMException("This operation was aborted", "AbortError")),
          );
        }),
    );
    const pending = client(hang as unknown as typeof fetch, { timeoutMs: 100 })
      .listSecrets(QUERY)
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(99);
    expect(signals[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signals[0]?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    const err = (await pending) as AnchorError;
    expect(err).toBeInstanceOf(AnchorError);
    expect(err.code).toBe("timeout");
    expect(hang).toHaveBeenCalledTimes(3);
  });

  it("uses a 10 s timeout by default", async () => {
    const signals: AbortSignal[] = [];
    const hang = (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>(() => {
        signals.push(init?.signal as AbortSignal);
      });
    void client(hang as unknown as typeof fetch)
      .listSecrets(QUERY)
      .catch(() => {});
    await vi.advanceTimersByTimeAsync(9_999);
    expect(signals[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signals[0]?.aborted).toBe(true);
  });
});

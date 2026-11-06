import { ERROR_CODES, type ErrorCode } from "@anchor/shared";
import { describe, expect, it } from "vitest";
import { createApiClient } from "#src/api/client";
import { ApiRequestError, type HttpOptions, request } from "#src/api/http";
import { EXIT, exitCodeForApiError, toCliError } from "#src/errors";

type Call = { url: string; method: string; headers: Headers; body: string | undefined };

/** A fetch that records calls and replays scripted responses (or throws scripted errors). */
function scriptedFetch(...script: (Response | Error | (() => Response))[]) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body as string | undefined,
    });
    const next = script.length > 1 ? script.shift() : script[0];
    if (next instanceof Error) throw next;
    if (typeof next === "function") return next();
    return (next as Response).clone();
  }) as typeof fetch;
  return { fn, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const apiError = (status: number, code: ErrorCode, message: string) =>
  json(status, { error: { code, message } });
const netError = (code: string) => new TypeError("fetch failed", { cause: { code } });

function opts(fetchFn: typeof fetch, extra: Partial<HttpOptions> = {}): HttpOptions {
  return {
    baseUrl: "https://anchor.example",
    token: "anc_s_abc",
    fetch: fetchFn,
    userAgent: "anchor-cli/1.0.0 (darwin-arm64)",
    sleep: async () => {},
    ...extra,
  };
}

async function rejection(p: Promise<unknown>): Promise<ApiRequestError> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(ApiRequestError);
  return e as ApiRequestError;
}

describe("http request", () => {
  it("sends bearer token, JSON headers and user agent", async () => {
    const f = scriptedFetch(json(200, { ok: true }));
    const res = await request<{ ok: boolean }>(opts(f.fn), "PUT", "/api/v1/x", { a: 1 });
    expect(res).toEqual({ status: 200, data: { ok: true } });
    const [call] = f.calls;
    expect(call?.url).toBe("https://anchor.example/api/v1/x");
    expect(call?.method).toBe("PUT");
    expect(call?.headers.get("authorization")).toBe("Bearer anc_s_abc");
    expect(call?.headers.get("accept")).toBe("application/json");
    expect(call?.headers.get("content-type")).toBe("application/json");
    expect(call?.headers.get("user-agent")).toBe("anchor-cli/1.0.0 (darwin-arm64)");
    expect(call?.body).toBe('{"a":1}');
  });

  it("omits Authorization without a token", async () => {
    const f = scriptedFetch(json(200, {}));
    await request(opts(f.fn, { token: undefined }), "GET", "/api/v1/x");
    expect(f.calls[0]?.headers.has("authorization")).toBe(false);
  });

  it("maps error body to ApiRequestError with server code and message", async () => {
    const f = scriptedFetch(apiError(404, "not_found", "Project not found"));
    const e = await rejection(request(opts(f.fn), "GET", "/api/v1/projects/x"));
    expect([e.status, e.code, e.message]).toEqual([404, "not_found", "Project not found"]);
  });

  it("maps a non-JSON error body to internal with the HTTP status", async () => {
    const f = scriptedFetch(new Response("<html>bad gateway</html>", { status: 418 }));
    const e = await rejection(request(opts(f.fn), "GET", "/api/v1/x"));
    expect([e.status, e.code, e.message]).toEqual([
      418,
      "internal",
      "Unexpected response from server (HTTP 418)",
    ]);
  });

  it("retries GET on 503 twice then succeeds; never retries POST or DELETE", async () => {
    const delays: number[] = [];
    const sleep = async (ms: number) => {
      delays.push(ms);
    };
    const get = scriptedFetch(
      apiError(503, "internal", "busy"),
      apiError(503, "internal", "busy"),
      json(200, { ok: 1 }),
    );
    expect((await request(opts(get.fn, { sleep }), "GET", "/api/v1/x")).data).toEqual({ ok: 1 });
    expect(get.calls).toHaveLength(3);
    expect(delays).toEqual([250, 1000]);

    for (const method of ["POST", "DELETE"] as const) {
      const f = scriptedFetch(apiError(503, "internal", "busy"), json(200, {}));
      await rejection(request(opts(f.fn), method, "/api/v1/x"));
      expect(f.calls).toHaveLength(1);
      const n = scriptedFetch(netError("ECONNRESET"), json(200, {}));
      await rejection(request(opts(n.fn), method, "/api/v1/x"));
      expect(n.calls).toHaveLength(1);
    }
  });

  it("gives up after two retries", async () => {
    const f = scriptedFetch(apiError(502, "internal", "bad gateway"));
    const e = await rejection(request(opts(f.fn), "GET", "/api/v1/x"));
    expect(f.calls).toHaveLength(3);
    expect(e.status).toBe(502);
  });

  it("retries PUT on network error", async () => {
    const f = scriptedFetch(netError("ECONNRESET"), json(200, { ok: 1 }));
    expect((await request(opts(f.fn), "PUT", "/api/v1/x", {})).data).toEqual({ ok: 1 });
    expect(f.calls).toHaveLength(2);
  });

  it("does not retry on 4xx", async () => {
    for (const status of [400, 401, 403, 404, 409]) {
      const f = scriptedFetch(apiError(status as 400, "bad_request", "no"), json(200, {}));
      await rejection(request(opts(f.fn), "GET", "/api/v1/x"));
      expect(f.calls).toHaveLength(1);
    }
  });

  it("retries GET on 429", async () => {
    const f = scriptedFetch(apiError(429, "rate_limited", "slow down"), json(200, {}));
    await request(opts(f.fn), "GET", "/api/v1/x");
    expect(f.calls).toHaveLength(2);
  });

  it("times out with code timeout", async () => {
    const hang = (async (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof fetch;
    const e = await rejection(request(opts(hang, { timeoutMs: 10, maxRetries: 0 }), "GET", "/x"));
    expect(e.status).toBe(0);
    expect(e.code).toBe("timeout");
    expect(e.message).toBe("Request to https://anchor.example timed out after 0.01s");
  });

  it("maps ECONNREFUSED / ENOTFOUND / CERT_HAS_EXPIRED causes to the documented messages", async () => {
    const cases: [Error, string][] = [
      [netError("ECONNREFUSED"), "Could not connect to https://anchor.example"],
      [netError("ENOTFOUND"), "Could not resolve host anchor.example"],
      [
        netError("CERT_HAS_EXPIRED"),
        "TLS certificate verification failed for https://anchor.example",
      ],
      [
        netError("UNABLE_TO_VERIFY_LEAF_SIGNATURE"),
        "TLS certificate verification failed for https://anchor.example",
      ],
      [
        new TypeError("fetch failed", {
          cause: Object.assign(new AggregateError([]), {
            errors: [{ code: "ECONNREFUSED" }, { code: "ECONNREFUSED" }],
          }),
        }),
        "Could not connect to https://anchor.example",
      ],
    ];
    for (const [err, message] of cases) {
      const f = scriptedFetch(err);
      const e = await rejection(request(opts(f.fn, { maxRetries: 0 }), "GET", "/x"));
      expect([e.status, e.code, e.message]).toEqual([0, "network_error", message]);
    }
  });

  it("debug line has method, path without query, status and duration only", async () => {
    const lines: string[] = [];
    const f = scriptedFetch(
      json(200, { secrets: [{ key: "K", path: "/", version: 1, value: "VALUECANARY" }] }),
    );
    const api = createApiClient(
      opts(f.fn, { token: "anc_s_TOKENCANARY", debug: (l) => lines.push(l) }),
    );
    const secrets = await api.listSecrets("app", "dev", { path: "/api", reveal: true });
    expect(secrets[0]?.value).toBe("VALUECANARY");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^GET \/api\/v1\/projects\/app\/environments\/dev\/secrets -> 200 \(\d+ms\)$/,
    );
    expect(lines.join("\n")).not.toContain("TOKENCANARY");
    expect(lines.join("\n")).not.toContain("VALUECANARY");
  });
});

describe("api client", () => {
  it("putSecret reports created from 201 vs 200", async () => {
    const secret = { key: "K", path: "/", version: 1, comment: "", updatedAt: 1 };
    const f = scriptedFetch(json(201, { secret }), json(200, { secret }));
    const api = createApiClient(opts(f.fn));
    expect(await api.putSecret("app", "dev", "K", { value: "v", path: "/" })).toEqual({
      secret,
      created: true,
    });
    expect((await api.putSecret("app", "dev", "K", { value: "v", path: "/" })).created).toBe(false);
    expect(f.calls[0]?.url).toBe(
      "https://anchor.example/api/v1/projects/app/environments/dev/secrets/K",
    );
    expect(JSON.parse(f.calls[0]?.body ?? "")).toEqual({ value: "v", path: "/" });
  });

  it("encodes path segments and query parameters", async () => {
    const f = scriptedFetch(json(200, { secret: {} }));
    const api = createApiClient(opts(f.fn));
    await api.getSecret("a/b", "d?v", "K", { path: "/x y" });
    expect(f.calls[0]?.url).toBe(
      "https://anchor.example/api/v1/projects/a%2Fb/environments/d%3Fv/secrets/K?path=%2Fx+y",
    );
  });

  it("sends expansion flags only when given, and calls the version endpoints", async () => {
    const version = { version: 2, comment: "", createdAt: 1, createdBy: null };
    const secret = { key: "K", path: "/a", version: 3, comment: "", updatedAt: 1 };
    const f = scriptedFetch(
      json(200, { secrets: [] }),
      json(200, { secret }),
      json(200, { versions: [version] }),
      json(200, { version: { ...version, value: "v" } }),
      json(200, { secret, changed: true }),
    );
    const api = createApiClient(opts(f.fn));
    await api.listSecrets("app", "dev", {
      path: "/a",
      reveal: true,
      expand: false,
      includeImports: true,
    });
    await api.getSecret("app", "dev", "K", { path: "/a", expand: true });
    expect(await api.listVersions("app", "dev", "K", { path: "/a" })).toEqual([version]);
    expect(await api.getSecretVersion("app", "dev", "K", 2, { path: "/a" })).toEqual({
      ...version,
      value: "v",
    });
    expect(await api.rollbackSecret("app", "dev", "K", { path: "/a", version: 2 })).toEqual({
      secret,
      changed: true,
    });
    const base = "https://anchor.example/api/v1/projects/app/environments/dev/secrets";
    expect(f.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${base}?path=%2Fa&reveal=true&expand=false&includeImports=true`,
      `GET ${base}/K?path=%2Fa&expand=true`,
      `GET ${base}/K/versions?path=%2Fa`,
      `GET ${base}/K/versions/2?path=%2Fa`,
      `POST ${base}/K/rollback`,
    ]);
    expect(JSON.parse(f.calls[4]?.body ?? "")).toEqual({ path: "/a", version: 2 });
  });

  it("unwraps response envelopes", async () => {
    const project = { id: "p", slug: "app", name: "App", createdAt: 1 };
    const token = { id: "t" };
    const f = scriptedFetch(
      json(200, { projects: [project] }),
      json(200, { project }),
      json(200, { environments: [] }),
      json(200, { serviceTokens: [token] }),
      json(201, { serviceToken: token, token: "anc_st_x" }),
      new Response(null, { status: 204 }),
      json(200, { user: { id: "u" } }),
    );
    const api = createApiClient(opts(f.fn));
    expect(await api.listProjects()).toEqual([project]);
    expect(await api.getProject("app")).toEqual(project);
    expect(await api.listEnvironments("app")).toEqual([]);
    expect(await api.listServiceTokens("app")).toEqual([token]);
    const body = {
      name: "ci",
      permission: "read" as const,
      scopes: [{ environment: "dev", path: "/" }],
      expiresInDays: 90,
    };
    expect(await api.createServiceToken("app", body)).toEqual({
      serviceToken: token,
      token: "anc_st_x",
    });
    expect(await api.revokeServiceToken("app", "t")).toBeUndefined();
    expect(await api.me()).toEqual({ user: { id: "u" } });
    expect(f.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "GET /api/v1/projects",
      "GET /api/v1/projects/app",
      "GET /api/v1/projects/app/environments",
      "GET /api/v1/projects/app/service-tokens",
      "POST /api/v1/projects/app/service-tokens",
      "DELETE /api/v1/projects/app/service-tokens/t",
      "GET /api/v1/auth/me",
    ]);
  });

  it("login sends client cli", async () => {
    const f = scriptedFetch(json(200, { user: {}, token: "anc_s_x", expiresAt: 1 }));
    await createApiClient(opts(f.fn, { token: undefined })).login("a@b.c", "pw");
    expect(JSON.parse(f.calls[0]?.body ?? "")).toEqual({
      email: "a@b.c",
      password: "pw",
      client: "cli",
    });
  });
});

describe("error mapping", () => {
  it("exitCodeForApiError maps every ErrorCode", () => {
    const expected: Record<ErrorCode, number> = {
      bad_request: 1,
      unauthenticated: 3,
      invalid_credentials: 3,
      forbidden: 4,
      not_found: 5,
      conflict: 6,
      rate_limited: 1,
      setup_disabled: 1,
      payload_too_large: 1,
      internal: 1,
    };
    for (const code of ERROR_CODES) {
      expect(exitCodeForApiError(new ApiRequestError(400, code, "m"))).toBe(expected[code]);
    }
    expect(exitCodeForApiError(new ApiRequestError(0, "network_error", "m"))).toBe(1);
    expect(exitCodeForApiError(new ApiRequestError(0, "timeout", "m"))).toBe(1);
  });

  it("toCliError explains an expired session or a rejected ANCHOR_TOKEN", () => {
    const e401 = new ApiRequestError(401, "unauthenticated", "Unauthenticated");
    const stored = toCliError(e401, { apiUrl: "https://a.example", authSource: "stored" });
    expect([stored.exitCode, stored.message, stored.hint]).toEqual([
      EXIT.AUTH,
      "Your session has expired or was revoked",
      "Run 'anchor login'",
    ]);
    const env = toCliError(e401, { apiUrl: "https://a.example", authSource: "ANCHOR_TOKEN" });
    expect([env.exitCode, env.message]).toEqual([
      EXIT.AUTH,
      "ANCHOR_TOKEN was rejected (expired, revoked or invalid)",
    ]);
    const forbidden = toCliError(new ApiRequestError(403, "forbidden", "Forbidden"), {
      apiUrl: "https://a.example",
    });
    expect([forbidden.exitCode, forbidden.message]).toEqual([EXIT.FORBIDDEN, "Forbidden"]);
  });
});

describe("configureProxyFromEnv", () => {
  it("does nothing when no proxy variable is set", async () => {
    const { configureProxyFromEnv } = await import("#src/api/proxy");
    expect(await configureProxyFromEnv({})).toBeUndefined();
  });

  it("returns a proxy-aware fetch when HTTPS_PROXY is set", async () => {
    const { configureProxyFromEnv } = await import("#src/api/proxy");
    expect(typeof (await configureProxyFromEnv({ HTTPS_PROXY: "http://127.0.0.1:9" }))).toBe(
      "function",
    );
  });
});

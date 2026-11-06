import { env } from "cloudflare:workers";
import { type ApiErrorBody, putSecretBodySchema } from "@anchor/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "#src/app";
import { ApiError, IntegrityError } from "#src/lib/errors";
import { parseJson } from "#src/lib/validate";
import { json } from "#test/support";

const app = createApp();
app.get("/api/v1/__boom", () => {
  throw new Error("secret-marker-123");
});
app.get("/api/v1/__teapot", () => {
  throw new ApiError(409, "conflict", "already exists");
});
app.get("/api/v1/__integrity", () => {
  throw new IntegrityError("bad tag", { sid: "s1", version: 1 });
});
app.post("/api/v1/__body", async (c) => c.json(await parseJson(c, putSecretBodySchema)));

const post = (body: string) =>
  app.request(
    "/api/v1/__body",
    { method: "POST", body, headers: { "content-type": "application/json" } },
    env,
  );

afterEach(() => vi.restoreAllMocks());

describe("error contract", () => {
  it("unknown route -> 404 not_found JSON", async () => {
    const res = await app.request("/api/v1/nope", {}, env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: "Route not found" } });
  });

  it("ApiError keeps status/code/message", async () => {
    const res = await app.request("/api/v1/__teapot", {}, env);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: "conflict", message: "already exists" } });
  });

  it("unexpected error -> 500 internal without leaking message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await app.request("/api/v1/__boom", {}, env);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: { code: "internal", message: "Internal error" } });
    expect(text).not.toContain("secret-marker-123");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret-marker-123");
    expect(JSON.stringify(spy.mock.calls)).toContain("unhandled_error");
  });

  it("IntegrityError -> 500 internal and logs secret_decrypt_failed", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await app.request("/api/v1/__integrity", {}, env);
    expect(res.status).toBe(500);
    expect((await json<ApiErrorBody>(res)).error.code).toBe("internal");
    const line = JSON.parse(spy.mock.calls[0]?.[0] as string);
    expect(line).toMatchObject({
      level: "error",
      event: "secret_decrypt_failed",
      sid: "s1",
      version: 1,
    });
  });

  it("invalid body -> 400 naming field, not echoing value", async () => {
    const res = await post(JSON.stringify({ value: 42, comment: "hunter2-marker" }));
    expect(res.status).toBe(400);
    const body = await json<ApiErrorBody>(res);
    expect(body.error.code).toBe("bad_request");
    expect(body.error.message).toContain("value");
    expect(JSON.stringify(body)).not.toContain("hunter2-marker");
  });

  it("malformed JSON -> 400", async () => {
    const res = await post("{");
    expect(res.status).toBe(400);
    expect((await json<ApiErrorBody>(res)).error.code).toBe("bad_request");
  });

  it("oversized value -> 413 payload_too_large", async () => {
    const res = await post(JSON.stringify({ value: "a".repeat(65537) }));
    expect(res.status).toBe(413);
    expect((await json<ApiErrorBody>(res)).error.code).toBe("payload_too_large");
  });

  it("valid body passes through with defaults", async () => {
    const res = await post(JSON.stringify({ value: "v", path: "api/" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ value: "v", comment: "", path: "/api" });
  });
});

describe("no-store on error responses", () => {
  it("404 and 500 responses carry Cache-Control: no-store", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const path of ["/api/v1/nope", "/api/v1/__boom"]) {
      const res = await app.request(path, {}, env);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });
});

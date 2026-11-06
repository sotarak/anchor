import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, fixtures, server } from "#test/support";
import { ApiClientError, apiFetch, setUnauthenticatedHandler } from "@/lib/api/client";
import { api } from "@/lib/api/endpoints";

afterEach(() => setUnauthenticatedHandler(() => {}));

describe("apiFetch", () => {
  it("apiFetch parses error bodies into ApiClientError with status and code", async () => {
    server.use(
      http.get("/api/v1/projects/nope", () => apiError(404, "not_found", "Project not found")),
    );
    const e = await apiFetch("/projects/nope").catch((err: unknown) => err);
    expect(e).toBeInstanceOf(ApiClientError);
    expect(e).toMatchObject({ status: 404, code: "not_found", message: "Project not found" });
  });

  it("apiFetch returns undefined on 204", async () => {
    server.use(http.delete("/api/v1/invites/inv_1", () => new HttpResponse(null, { status: 204 })));
    expect(await apiFetch("/invites/inv_1", { method: "DELETE" })).toBeUndefined();
  });

  it("network failure -> code network_error", async () => {
    server.use(http.get("/api/v1/projects", () => HttpResponse.error()));
    await expect(apiFetch("/projects")).rejects.toMatchObject({ status: 0, code: "network_error" });
  });

  it("a non-JSON error body -> invalid_response with the status", async () => {
    server.use(
      http.get(
        "/api/v1/projects",
        () => new HttpResponse("<html>bad gateway</html>", { status: 502 }),
      ),
    );
    await expect(apiFetch("/projects")).rejects.toMatchObject({
      status: 502,
      code: "invalid_response",
    });
  });

  it("sends JSON with same-origin credentials and query params", async () => {
    let seen: Request | undefined;
    server.use(
      http.post("/api/v1/projects", async ({ request }) => {
        seen = request.clone();
        return HttpResponse.json({ project: fixtures.project }, { status: 201 });
      }),
    );
    await apiFetch("/projects", { method: "POST", body: { name: "App", slug: "app" } });
    expect(seen?.headers.get("content-type")).toBe("application/json");
    expect(seen?.credentials).toBe("same-origin");
    expect(await seen?.json()).toEqual({ name: "App", slug: "app" });
  });
});

describe("unauthenticated handler", () => {
  it("401 on /projects calls the unauthenticated handler once; 401 on /auth/login does not", async () => {
    const handler = vi.fn();
    setUnauthenticatedHandler(handler);
    server.use(
      http.get("/api/v1/projects", () =>
        apiError(401, "unauthenticated", "Authentication required"),
      ),
      http.post("/api/v1/auth/login", () =>
        apiError(401, "invalid_credentials", "Invalid email or password"),
      ),
    );
    await expect(apiFetch("/projects")).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledTimes(1);
    await expect(
      apiFetch("/auth/login", { method: "POST", body: { email: "a@b.c", password: "x" } }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("401 on /auth/me does not call the handler (the guard handles it)", async () => {
    const handler = vi.fn();
    setUnauthenticatedHandler(handler);
    server.use(
      http.get("/api/v1/auth/me", () =>
        apiError(401, "unauthenticated", "Authentication required"),
      ),
    );
    await expect(api.auth.me()).rejects.toMatchObject({ status: 401 });
    expect(handler).not.toHaveBeenCalled();
  });

  it("a wrong current password (401 invalid_credentials) does not log the user out", async () => {
    const handler = vi.fn();
    setUnauthenticatedHandler(handler);
    server.use(
      http.post("/api/v1/auth/password", () =>
        apiError(401, "invalid_credentials", "Current password is incorrect"),
      ),
    );
    await expect(
      api.auth.changePassword({ currentPassword: "x", newPassword: "a long new passphrase" }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("403 does not call the unauthenticated handler", async () => {
    const handler = vi.fn();
    setUnauthenticatedHandler(handler);
    server.use(
      http.get("/api/v1/projects/app/members", () => apiError(403, "forbidden", "Forbidden")),
    );
    await expect(api.members.list("app")).rejects.toMatchObject({ status: 403, code: "forbidden" });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("endpoints", () => {
  it("api.secrets.list never sends reveal=true", async () => {
    let url: URL | undefined;
    server.use(
      http.get("/api/v1/projects/app/environments/dev/secrets", ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json({ secrets: fixtures.secrets });
      }),
    );
    expect(await api.secrets.list("app", "dev", "/api")).toEqual(fixtures.secrets);
    expect(url?.searchParams.get("path")).toBe("/api");
    expect(url?.searchParams.has("reveal")).toBe(false);
  });

  it("api.secrets.get encodes the key and path and returns the secret with its value", async () => {
    let url: URL | undefined;
    server.use(
      http.get("/api/v1/projects/app/environments/dev/secrets/API_KEY", ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json({ secret: { ...fixtures.secrets[0], value: "v" } });
      }),
    );
    expect((await api.secrets.get("app", "dev", "API_KEY", "/")).value).toBe("v");
    expect(url?.searchParams.get("path")).toBe("/");
  });

  it("api.audit.list sends filters and the before cursor", async () => {
    let url: URL | undefined;
    server.use(
      http.get("/api/v1/audit", ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json({ events: [], nextCursor: null });
      }),
    );
    await api.audit.list({ action: "secret.read", before: "c1", limit: 25 });
    expect(Object.fromEntries(url?.searchParams ?? [])).toEqual({
      action: "secret.read",
      before: "c1",
      limit: "25",
    });
  });
});

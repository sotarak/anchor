import type { ApiErrorBody } from "@anchor/shared";
import { describe, expect, it } from "vitest";
import { api, json } from "#test/support";

// The dashboard is served by static assets in SPA mode; `/api/*` must still reach the Worker.
describe("static assets routing", () => {
  it("unknown /api route still returns the JSON 404", async () => {
    const res = await api("/api/v1/nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect((await json<ApiErrorBody>(res)).error.code).toBe("not_found");
  });

  it("/api/v1/health still served by the worker", async () => {
    const res = await api("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it.each([
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
  ])("%s is served by the worker", async (path) => {
    const res = await api(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

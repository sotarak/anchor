import { describe, expect, it } from "vitest";
import { api } from "#test/support";

describe("GET /api/v1/health", () => {
  it("returns ok with no-store caching", async () => {
    const res = await api("/api/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

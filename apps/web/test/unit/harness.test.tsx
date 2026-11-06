import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "#test/support";

describe("test harness", () => {
  it("MSW intercepts fetch", async () => {
    server.use(http.get("/api/v1/health", () => HttpResponse.json({ status: "ok" })));
    const res = await fetch("/api/v1/health");
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

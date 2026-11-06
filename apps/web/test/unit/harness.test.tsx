import { screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { renderApp, server } from "#test/support";

describe("test harness", () => {
  it("renders the root route at /", async () => {
    await renderApp("/");
    expect(await screen.findByText("Anchor")).toBeInTheDocument();
  });

  it("MSW intercepts fetch", async () => {
    server.use(http.get("/api/v1/health", () => HttpResponse.json({ status: "ok" })));
    const res = await fetch("/api/v1/health");
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

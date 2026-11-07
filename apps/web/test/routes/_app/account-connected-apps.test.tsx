import type { OAuthGrantDto } from "@anchor/shared";
import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { fixtures, renderApp, server, signedInAs } from "#test/support";

const now = Date.now();
const grant: OAuthGrantDto = {
  id: "g1",
  clientName: "Claude Code",
  scopes: ["secrets:read", "secrets:write", "secrets:reveal"],
  createdAt: now - 86_400_000,
  lastUsedAt: null,
};

function grantsAre(list: OAuthGrantDto[]) {
  const store = { list: [...list] };
  const revoke = vi.fn(({ params }: { params: Record<string, string | readonly string[]> }) => {
    store.list = store.list.filter((g) => g.id !== params.id);
    return new HttpResponse(null, { status: 204 });
  });
  server.use(
    http.get("/api/v1/auth/sessions", () => HttpResponse.json({ sessions: [] })),
    http.get("/api/v1/oauth/grants", () => HttpResponse.json({ grants: store.list })),
    http.delete("/api/v1/oauth/grants/:id", revoke),
  );
  return revoke;
}

const region = () => screen.getByRole("region", { name: "Connected apps" });

describe("/account connected apps", () => {
  it("lists apps with their permissions", async () => {
    signedInAs(fixtures.owner);
    grantsAre([grant]);
    await renderApp("/account");
    expect(await within(region()).findByText("Claude Code")).toBeInTheDocument();
    expect(within(region()).getByText("Read")).toBeInTheDocument();
    expect(within(region()).getByText("Write")).toBeInTheDocument();
    expect(within(region()).getByText("Reveal")).toBeInTheDocument();
  });

  it("revoke asks first, naming the app, then calls DELETE", async () => {
    signedInAs(fixtures.owner);
    const revoke = grantsAre([grant]);
    const { user } = await renderApp("/account");
    await within(region()).findByText("Claude Code");
    await user.click(within(region()).getByRole("button", { name: "Revoke Claude Code" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Revoke Claude Code")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Revoke app" }));
    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(1));
    expect(await within(region()).findByText("No apps are connected.")).toBeInTheDocument();
  });

  it("empty state", async () => {
    signedInAs(fixtures.owner);
    grantsAre([]);
    await renderApp("/account");
    expect(await within(region()).findByText("No apps are connected.")).toBeInTheDocument();
  });
});

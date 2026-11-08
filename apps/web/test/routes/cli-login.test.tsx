import type { CliLoginRequestDto } from "@anchor/shared";
import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { apiError, fixtures, renderApp, server, signedInAs, signedOut } from "#test/support";

const CODE = "WDJB-MJHT";
const request: CliLoginRequestDto = {
  userCode: CODE,
  clientName: "dev@laptop",
  userAgent: "anchor-cli/0.4.0",
  ip: "203.0.113.7",
  createdAt: Date.now() - 10_000,
  expiresAt: Date.now() + 590_000,
};
const WARNING =
  "Only approve if you just ran anchor login. Approving signs this terminal in as you.";
const DONE = "You can close this tab and return to your terminal.";
const GONE = "This login request expired or was already used.";
const HELPER = "Type the code from your terminal yourself. Never enter a code someone sent you.";

/** Opens /cli/login and types the code, the only way to reach a request since 0.5.3. */
async function openWithCode(code = CODE, path = "/cli/login") {
  const app = await renderApp(path);
  await app.user.type(await screen.findByLabelText("Code"), code);
  await app.user.click(screen.getByRole("button", { name: "Continue" }));
  return app;
}

function pending(found = true) {
  const paths: string[] = [];
  const get = vi.fn(({ params }: { params: Record<string, string | readonly string[]> }) =>
    found && params.code === CODE
      ? HttpResponse.json(request)
      : apiError(404, "not_found", "This login request expired or was already used"),
  );
  const approve = vi.fn(({ request }: { request: Request }) => {
    paths.push(new URL(request.url).pathname);
    return new HttpResponse(null, { status: 204 });
  });
  const deny = vi.fn(() => new HttpResponse(null, { status: 204 }));
  server.use(
    http.get("/api/v1/auth/cli/requests/:code", get),
    http.post("/api/v1/auth/cli/requests/:code/approve", approve),
    http.post("/api/v1/auth/cli/requests/:code/deny", deny),
  );
  return { get, approve, deny, paths };
}

describe("/cli/login", () => {
  it("shows the request and the warning", async () => {
    signedInAs(fixtures.owner);
    pending();
    await openWithCode();
    expect(await screen.findByText(CODE)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Approve CLI login" })).toBeInTheDocument();
    expect(
      await screen.findByText(`A terminal wants to sign in as ${fixtures.owner.email}`),
    ).toBeInTheDocument();
    expect(screen.getByText("Check that it matches your terminal")).toBeInTheDocument();
    expect(screen.getAllByRole("term").map((t) => t.textContent)).toEqual([
      "Device",
      "IP address",
      "Requested",
    ]);
    expect(screen.getAllByRole("definition").map((d) => d.textContent)).toEqual([
      "dev@laptop",
      "203.0.113.7",
      "less than a minute ago",
    ]);
    expect(screen.getByText(WARNING)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deny" })).toHaveClass("flex-1");
    expect(screen.getByRole("button", { name: "Approve" })).toHaveClass("flex-1");
  });

  it("approve", async () => {
    signedInAs(fixtures.owner);
    const { approve, paths } = pending();
    const { user } = await openWithCode();
    await user.click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByText(DONE)).toBeInTheDocument();
    expect(approve).toHaveBeenCalledTimes(1);
    expect(paths).toEqual([`/api/v1/auth/cli/requests/${CODE}/approve`]);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deny" })).toBeNull();
  });

  it("deny", async () => {
    signedInAs(fixtures.owner);
    const { deny, approve } = pending();
    const { user } = await openWithCode();
    await user.click(await screen.findByRole("button", { name: "Deny" }));
    expect(await screen.findByText(DONE)).toBeInTheDocument();
    expect(deny).toHaveBeenCalledTimes(1);
    expect(approve).not.toHaveBeenCalled();
  });

  it("expired", async () => {
    signedInAs(fixtures.owner);
    pending(false);
    await openWithCode();
    expect(await screen.findByText(GONE)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("a code in the link is ignored: the person must type the one in their terminal", async () => {
    signedInAs(fixtures.owner);
    const { get, approve } = pending();
    await renderApp(`/cli/login?code=${CODE}`);
    const input = await screen.findByLabelText("Code");
    expect(input).toHaveValue("");
    expect(screen.getByText(HELPER)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(get).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  });

  it("no code: typing it loosely works", async () => {
    signedInAs(fixtures.owner);
    const { get } = pending();
    const { user } = await renderApp("/cli/login");
    const input = await screen.findByLabelText("Code");
    await user.type(input, "AEIO");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      await screen.findByText("Enter the 8-letter code shown in your terminal"),
    ).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, "wdjb mjht");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(CODE)).toBeInTheDocument();
    expect(screen.getByText("dev@laptop")).toBeInTheDocument();
  });

  it("signed out goes to login and comes back to the code form", async () => {
    signedOut();
    const { router } = await renderApp("/cli/login");
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.searchStr).toBe("?redirect=%2Fcli%2Flogin");
  });
});

import type { OAuthAuthorizeCheckDto } from "@anchor/shared";
import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, fixtures, renderApp, server, signedInAs, signedOut } from "#test/support";

const leave = vi.hoisted(() => vi.fn());
vi.mock("@/lib/leave-page", () => ({ leavePage: leave }));

const QUERY = new URLSearchParams({
  response_type: "code",
  client_id: "client-1",
  redirect_uri: "http://localhost:33418/callback",
  code_challenge: "abc",
  code_challenge_method: "S256",
  state: "st-1",
  scope: "secrets:read secrets:write secrets:reveal",
}).toString();
const PAGE = `/oauth/authorize?${QUERY}`;
const COPY = "Only approve if you just connected an AI agent or app to Anchor.";
const dto = (over: Partial<OAuthAuthorizeCheckDto> = {}): OAuthAuthorizeCheckDto => ({
  client: { id: "client-1", name: "Claude Code", redirectHost: "localhost:33418" },
  scopes: ["secrets:read", "secrets:write", "secrets:reveal"],
  revealRequested: true,
  ...over,
});

function consent(check: () => Response) {
  const checks: unknown[] = [];
  const decisions: Record<string, unknown>[] = [];
  server.use(
    http.post("/api/v1/oauth/authorize/check", async ({ request }) => {
      checks.push(await request.json());
      return check();
    }),
    http.post("/api/v1/oauth/authorize/decision", async ({ request }) => {
      decisions.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ redirectTo: "http://localhost:33418/callback?code=x&state=st-1" });
    }),
  );
  return { checks, decisions };
}

beforeEach(() => leave.mockReset());

describe("/oauth/authorize", () => {
  it("shows the client, the redirect host, the scopes in words and the warning", async () => {
    signedInAs(fixtures.owner);
    const { checks } = consent(() => HttpResponse.json(dto()));
    await renderApp(PAGE);
    expect(await screen.findByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByText("localhost:33418")).toBeInTheDocument();
    expect(
      screen.getByText("See your projects, secrets and non-sensitive values"),
    ).toBeInTheDocument();
    expect(screen.getByText("Create, change and delete secrets")).toBeInTheDocument();
    expect(screen.getByText(COPY)).toBeInTheDocument();
    expect(checks[0]).toMatchObject({
      client_id: "client-1",
      state: "st-1",
      code_challenge: "abc",
    });
  });

  it("the reveal checkbox appears only when requested, unchecked", async () => {
    signedInAs(fixtures.owner);
    consent(() => HttpResponse.json(dto()));
    await renderApp(PAGE);
    const box = await screen.findByRole("checkbox", {
      name: "Also allow reading sensitive values",
    });
    expect(box).not.toBeChecked();
  });

  it("no reveal checkbox when reveal was not requested", async () => {
    signedInAs(fixtures.owner);
    consent(() => HttpResponse.json(dto({ scopes: ["secrets:read"], revealRequested: false })));
    await renderApp(PAGE);
    await screen.findByText("Claude Code");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText("Create, change and delete secrets")).toBeNull();
  });

  it("approve posts allowReveal false by default and leaves for redirectTo", async () => {
    signedInAs(fixtures.owner);
    const { decisions } = consent(() => HttpResponse.json(dto()));
    const { user } = await renderApp(PAGE);
    await user.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(leave).toHaveBeenCalledTimes(1));
    expect(leave).toHaveBeenCalledWith("http://localhost:33418/callback?code=x&state=st-1");
    expect(decisions[0]).toMatchObject({
      approve: true,
      allowReveal: false,
      client_id: "client-1",
    });
  });

  it("ticking the box sends allowReveal true", async () => {
    signedInAs(fixtures.owner);
    const { decisions } = consent(() => HttpResponse.json(dto()));
    const { user } = await renderApp(PAGE);
    await user.click(
      await screen.findByRole("checkbox", { name: "Also allow reading sensitive values" }),
    );
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(decisions).toHaveLength(1));
    expect(decisions[0]).toMatchObject({ approve: true, allowReveal: true });
  });

  it("deny posts approve false", async () => {
    signedInAs(fixtures.owner);
    const { decisions } = consent(() => HttpResponse.json(dto()));
    const { user } = await renderApp(PAGE);
    await user.click(await screen.findByRole("button", { name: "Deny" }));
    await waitFor(() => expect(leave).toHaveBeenCalledTimes(1));
    expect(decisions[0]).toMatchObject({ approve: false });
  });

  it("a check that answers redirectTo leaves at once, without buttons", async () => {
    signedInAs(fixtures.owner);
    consent(() =>
      HttpResponse.json({ redirectTo: "http://localhost:33418/callback?error=invalid_scope" }),
    );
    await renderApp(PAGE);
    await waitFor(() =>
      expect(leave).toHaveBeenCalledWith("http://localhost:33418/callback?error=invalid_scope"),
    );
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("a 400 from check shows its message and no buttons", async () => {
    signedInAs(fixtures.owner);
    consent(() =>
      apiError(400, "bad_request", "This app asked to return to an address it did not register."),
    );
    await renderApp(PAGE);
    expect(
      await screen.findByText("This app asked to return to an address it did not register."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(leave).not.toHaveBeenCalled();
  });

  it("signed out goes to login and keeps the whole query", async () => {
    signedOut();
    const { router } = await renderApp(PAGE);
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    const redirect = new URLSearchParams(router.state.location.searchStr).get("redirect") ?? "";
    const back = new URL(redirect, "http://x");
    expect(back.pathname).toBe("/oauth/authorize");
    expect(Object.fromEntries(back.searchParams)).toEqual(
      Object.fromEntries(new URLSearchParams(QUERY)),
    );
  });
});

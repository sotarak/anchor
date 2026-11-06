import type { SessionDto } from "@anchor/shared";
import { screen, waitFor, within } from "@testing-library/react";
import { delay, HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { apiError, fixtures, renderApp, server, signedInAs, signedOut } from "#test/support";

const DAY = 86_400_000;
const now = Date.now();
const NEW_PASSWORD = "correct horse battery";

const current: SessionDto = {
  id: "aaaaaaaaaaaaaaaa",
  kind: "web",
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15",
  createdAt: now - 2 * DAY,
  lastUsedAt: now - 60_000,
  expiresAt: now + 5 * DAY,
  current: true,
};
const cli: SessionDto = {
  id: "bbbbbbbbbbbbbbbb",
  kind: "cli",
  userAgent: "anchor-cli/0.1.0",
  createdAt: now - 10 * DAY,
  lastUsedAt: null,
  expiresAt: now + 20 * DAY,
  current: false,
};

function sessionsAre(list: () => SessionDto[]) {
  const handler = vi.fn(() => HttpResponse.json({ sessions: list() }));
  server.use(http.get("/api/v1/auth/sessions", handler));
  return handler;
}

const sessionsTable = () =>
  within(screen.getByRole("region", { name: "Sessions" })).getByRole("table");

describe("/account", () => {
  it("shows the profile read-only", async () => {
    signedInAs(fixtures.owner);
    sessionsAre(() => [current]);
    await renderApp("/account");
    expect(await screen.findByRole("heading", { name: "Account" })).toBeInTheDocument();
    const profile = screen.getByRole("region", { name: "Profile" });
    expect(within(profile).getByLabelText("Name")).toHaveValue(fixtures.owner.name);
    expect(within(profile).getByLabelText("Name")).toHaveAttribute("readonly");
    expect(within(profile).getByLabelText("Email")).toHaveValue(fixtures.owner.email);
  });

  it("password change validates match and length, calls API, refreshes sessions", async () => {
    signedInAs(fixtures.owner);
    const list = sessionsAre(() => [current]);
    const change = vi.fn(async ({ request }: { request: Request }) => {
      expect(await request.json()).toEqual({
        currentPassword: "old password!",
        newPassword: NEW_PASSWORD,
      });
      return new HttpResponse(null, { status: 204 });
    });
    server.use(http.post("/api/v1/auth/password", change));
    const { user, queryClient } = await renderApp("/account");
    const form = screen.getByRole("region", { name: "Password" });
    await within(form).findByLabelText("Current password");
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

    await user.type(within(form).getByLabelText("Current password"), "old password!");
    await user.type(within(form).getByLabelText("New password"), "short");
    await user.type(within(form).getByLabelText("Confirm new password"), "different");
    await user.click(within(form).getByRole("button", { name: "Update password" }));
    expect(within(form).getByText("Use at least 12 characters")).toBeInTheDocument();
    expect(within(form).getByText("Passwords do not match")).toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();

    await user.clear(within(form).getByLabelText("New password"));
    await user.type(within(form).getByLabelText("New password"), NEW_PASSWORD);
    await user.clear(within(form).getByLabelText("Confirm new password"));
    await user.type(within(form).getByLabelText("Confirm new password"), NEW_PASSWORD);
    await user.click(within(form).getByRole("button", { name: "Update password" }));

    expect(
      await screen.findByText("Password updated. Other sessions were signed out."),
    ).toBeInTheDocument();
    expect(change).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(within(form).getByLabelText("Current password")).toHaveValue("");
    expect(within(form).getByLabelText("New password")).toHaveValue("");
    // Passwords never sit in the mutation cache.
    const cached = JSON.stringify(
      queryClient
        .getMutationCache()
        .getAll()
        .map((m) => m.state),
    );
    expect(cached).not.toContain(NEW_PASSWORD);
    expect(cached).not.toContain("old password!");
  });

  it("wrong current password shows field error and keeps the session", async () => {
    signedInAs(fixtures.owner);
    sessionsAre(() => [current]);
    server.use(
      http.post("/api/v1/auth/password", () =>
        apiError(401, "invalid_credentials", "Current password is incorrect"),
      ),
    );
    const { user, router } = await renderApp("/account");
    const form = screen.getByRole("region", { name: "Password" });
    await user.type(await within(form).findByLabelText("Current password"), "nope");
    await user.type(within(form).getByLabelText("New password"), NEW_PASSWORD);
    await user.type(within(form).getByLabelText("Confirm new password"), NEW_PASSWORD);
    await user.click(within(form).getByRole("button", { name: "Update password" }));
    expect(await within(form).findByText("Current password is incorrect")).toBeInTheDocument();
    expect(within(form).getByLabelText("Current password")).toHaveAttribute("aria-invalid", "true");
    expect(router.state.location.pathname).toBe("/account");
  });

  it("rate-limited password change shows the server message", async () => {
    signedInAs(fixtures.owner);
    sessionsAre(() => [current]);
    server.use(
      http.post("/api/v1/auth/password", () =>
        apiError(429, "rate_limited", "Too many failed attempts, try again later"),
      ),
    );
    const { user } = await renderApp("/account");
    const form = screen.getByRole("region", { name: "Password" });
    await user.type(await within(form).findByLabelText("Current password"), "whatever");
    await user.type(within(form).getByLabelText("New password"), NEW_PASSWORD);
    await user.type(within(form).getByLabelText("Confirm new password"), NEW_PASSWORD);
    await user.click(within(form).getByRole("button", { name: "Update password" }));
    expect(
      await within(form).findByText("Too many failed attempts, try again later"),
    ).toBeInTheDocument();
  });

  it("lists sessions; the current session is marked and cannot be revoked from the menu", async () => {
    signedInAs(fixtures.owner);
    sessionsAre(() => [current, cli]);
    const { user } = await renderApp("/account");
    await screen.findByText("anchor-cli/0.1.0");
    const rows = within(sessionsTable()).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    const [mine, other] = rows as [HTMLElement, HTMLElement];
    expect(within(mine).getByText("This session")).toBeInTheDocument();
    expect(within(mine).getByText("Web")).toBeInTheDocument();
    expect(within(mine).queryByRole("button", { name: /Actions for/ })).toBeNull();
    expect(within(mine).getByRole("button", { name: "Log out" })).toBeInTheDocument();
    expect(within(other).getByText("CLI")).toBeInTheDocument();
    expect(within(other).queryByText("This session")).toBeNull();
    expect(within(other).getByText("–")).toBeInTheDocument();
    await user.click(within(other).getByRole("button", { name: "Actions for CLI session" }));
    expect(await screen.findByRole("menuitem", { name: "Revoke" })).toBeInTheDocument();
  });

  it("revoking another session calls DELETE and refreshes", async () => {
    signedInAs(fixtures.owner);
    let revoked = false;
    const list = sessionsAre(() => (revoked ? [current] : [current, cli]));
    const del = vi.fn(({ params }: { params: Record<string, unknown> }) => {
      expect(params.id).toBe(cli.id);
      revoked = true;
      return new HttpResponse(null, { status: 204 });
    });
    server.use(http.delete("/api/v1/auth/sessions/:id", del));
    const { user } = await renderApp("/account");
    await screen.findByText("anchor-cli/0.1.0");
    await user.click(screen.getByRole("button", { name: "Actions for CLI session" }));
    await user.click(await screen.findByRole("menuitem", { name: "Revoke" }));
    const dialog = await screen.findByRole("dialog", { name: "Revoke CLI session" });
    await user.click(within(dialog).getByRole("button", { name: "Revoke session" }));
    await waitFor(() => expect(screen.queryByText("anchor-cli/0.1.0")).toBeNull());
    expect(del).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Session revoked")).toBeInTheDocument();
  });

  it("Log out on the current session signs out and goes to /login", async () => {
    signedInAs(fixtures.owner);
    sessionsAre(() => [current]);
    const logout = vi.fn(() => {
      signedOut();
      return new HttpResponse(null, { status: 204 });
    });
    server.use(http.post("/api/v1/auth/logout", logout));
    const { user, router } = await renderApp("/account");
    await screen.findByText("This session");
    await user.click(within(sessionsTable()).getByRole("button", { name: "Log out" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("sessions loading shows skeleton rows", async () => {
    signedInAs(fixtures.owner);
    server.use(http.get("/api/v1/auth/sessions", () => delay("infinite")));
    await renderApp("/account");
    const region = await screen.findByRole("region", { name: "Sessions" });
    expect((await within(region).findAllByTestId("skeleton-row")).length).toBeGreaterThan(0);
  });

  it("sessions empty state", async () => {
    signedInAs(fixtures.owner);
    sessionsAre(() => []);
    await renderApp("/account");
    expect(await screen.findByText("No active sessions")).toBeInTheDocument();
  });

  it("sessions error shows ErrorState with retry", async () => {
    signedInAs(fixtures.owner);
    let calls = 0;
    server.use(
      http.get("/api/v1/auth/sessions", () => {
        calls += 1;
        return calls === 1
          ? apiError(500, "internal", "Internal error")
          : HttpResponse.json({ sessions: [current] });
      }),
    );
    const { user } = await renderApp("/account");
    expect(await screen.findByText("Couldn't load this page")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("This session")).toBeInTheDocument();
  });
});

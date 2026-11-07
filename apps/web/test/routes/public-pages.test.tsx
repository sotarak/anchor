import type { QueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import {
  apiError,
  fixtures,
  projectExists,
  renderApp,
  server,
  signedInAs,
  signedOut,
} from "#test/support";

const STRONG = "correct horse battery";
const loginResponse = { user: fixtures.owner, expiresAt: Date.now() + 86_400_000 };

/** Passwords and one-time tokens must not linger in the MutationCache (variables or data). */
function expectNotInMutationCache(queryClient: QueryClient, ...secrets: string[]) {
  const cached = JSON.stringify(
    queryClient
      .getMutationCache()
      .getAll()
      .map((m) => m.state),
  );
  for (const secret of secrets) expect(cached).not.toContain(secret);
}

/** Puts a fragment on the real address bar (memory history drives routing; tokens live here). */
function withHash(path: string, hash: string) {
  window.history.replaceState(null, "", `${path}${hash}`);
}

describe("/setup", () => {
  async function fillSetup(user: Awaited<ReturnType<typeof renderApp>>["user"], confirm = STRONG) {
    await user.type(await screen.findByLabelText("Name"), "Olivia Owner");
    await user.type(screen.getByLabelText("Email"), "owner@example.com");
    await user.type(screen.getByLabelText("Password"), STRONG);
    await user.type(screen.getByLabelText("Confirm password"), confirm);
    await user.click(screen.getByRole("button", { name: "Create owner account" }));
  }

  it("setup asks for no token and posts only name, email and password", async () => {
    signedOut({ needsSetup: true });
    projectExists();
    const submit = vi.fn(async ({ request }: { request: Request }) => {
      expect(await request.json()).toEqual({
        name: "Olivia Owner",
        email: "owner@example.com",
        password: STRONG,
      });
      return HttpResponse.json(loginResponse, { status: 201 });
    });
    server.use(http.post("/api/v1/setup", submit));
    const { router, user, queryClient } = await renderApp("/setup");
    expect(await screen.findByLabelText("Name")).toHaveFocus();
    expect(screen.queryByLabelText(/setup token/i)).toBeNull();
    expect(document.body.textContent).not.toMatch(/setup token/i);
    await fillSetup(user);
    await waitFor(() => expect(router.state.location.pathname).toBe("/projects"));
    expect(submit).toHaveBeenCalledTimes(1);
    expectNotInMutationCache(queryClient, STRONG);
  });

  it("someone else finished setup first: says so and links to sign in", async () => {
    signedOut({ needsSetup: true });
    server.use(
      http.post("/api/v1/setup", () => apiError(409, "conflict", "Instance already set up")),
    );
    const { user } = await renderApp("/setup");
    await fillSetup(user);
    expect(await screen.findByText(/This instance already has an owner\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  it("mismatched passwords block submit", async () => {
    signedOut({ needsSetup: true });
    const submit = vi.fn(() => HttpResponse.json(loginResponse, { status: 201 }));
    server.use(http.post("/api/v1/setup", submit));
    const { user } = await renderApp("/setup");
    await fillSetup(user, "something else entirely");
    expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it("already set up redirects to /login", async () => {
    signedOut({ needsSetup: false });
    const { router } = await renderApp("/setup");
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  });
});

describe("/login", () => {
  async function logIn(url: string) {
    signedOut();
    projectExists();
    server.use(http.post("/api/v1/auth/login", () => HttpResponse.json(loginResponse)));
    const app = await renderApp(url);
    await app.user.type(await screen.findByLabelText("Email"), "owner@example.com");
    await app.user.type(screen.getByLabelText("Password"), STRONG);
    await app.user.click(screen.getByRole("button", { name: "Sign in" }));
    return app;
  }

  it("login preserves a safe redirect", async () => {
    const { router, queryClient } = await logIn(
      "/login?redirect=%2Fprojects%2Fapp%3Fpath%3D%252Fapi",
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/projects/app"));
    expect(router.state.location.search).toEqual({ path: "/api" });
    expectNotInMutationCache(queryClient, STRONG);
  });

  it("login ignores //evil.example redirect and lands on /projects", async () => {
    const { router } = await logIn("/login?redirect=%2F%2Fevil.example");
    await waitFor(() => expect(router.state.location.pathname).toBe("/projects"));
  });

  it("an authenticated visit to /login goes straight to the redirect", async () => {
    signedInAs(fixtures.owner);
    projectExists();
    const { router } = await renderApp("/login?redirect=%2Fprojects%2Fapp");
    await waitFor(() => expect(router.state.location.pathname).toBe("/projects/app"));
  });

  it("invalid credentials message", async () => {
    signedOut();
    server.use(
      http.post("/api/v1/auth/login", () =>
        apiError(401, "invalid_credentials", "Invalid email or password"),
      ),
    );
    const { user, router } = await renderApp("/login");
    await user.type(await screen.findByLabelText("Email"), "owner@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Invalid email or password")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("rate limited message", async () => {
    signedOut();
    server.use(
      http.post("/api/v1/auth/login", () => apiError(429, "rate_limited", "Too many attempts")),
    );
    const { user } = await renderApp("/login");
    await user.type(await screen.findByLabelText("Email"), "owner@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByText("Too many failed attempts. Try again in 15 minutes."),
    ).toBeInTheDocument();
  });
});

describe("/accept-invite", () => {
  it("accept invite: the hash is stripped before inspect is called", async () => {
    signedOut();
    projectExists();
    let hashAtInspect: string | null = null;
    server.use(
      http.post("/api/v1/invites/inspect", async ({ request }) => {
        hashAtInspect = window.location.hash;
        expect(await request.json()).toEqual({ token: "anc_inv_abc123" });
        return HttpResponse.json({ email: "new@example.com", role: "member" });
      }),
      http.post("/api/v1/invites/accept", async ({ request }) => {
        expect(await request.json()).toEqual({
          token: "anc_inv_abc123",
          name: "Nina New",
          password: STRONG,
        });
        return HttpResponse.json(
          { user: { ...fixtures.member, email: "new@example.com" }, expiresAt: 0 },
          { status: 201 },
        );
      }),
    );
    withHash("/accept-invite", "#token=anc_inv_abc123");
    const { router, user, queryClient } = await renderApp("/accept-invite");
    expect(await screen.findByDisplayValue("new@example.com")).toHaveAttribute("readonly");
    expect(hashAtInspect).toBe("");
    expect(screen.getByText("Member")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Name"), "Nina New");
    await user.type(screen.getByLabelText("Password"), STRONG);
    await user.type(screen.getByLabelText("Confirm password"), STRONG);
    await user.click(screen.getByRole("button", { name: "Accept invite" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/projects"));
    expectNotInMutationCache(queryClient, STRONG, "anc_inv_abc123");
  });

  it("accept invite: invalid token shows expired message and hash is stripped", async () => {
    signedOut();
    const inspect = vi.fn(() => apiError(404, "not_found", "Link is invalid or has expired"));
    server.use(http.post("/api/v1/invites/inspect", inspect));
    withHash("/accept-invite", "#token=anc_rst_wrongkind");
    await renderApp("/accept-invite");
    expect(
      await screen.findByText("This invite link is invalid or has expired"),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe("");
    expect(inspect).not.toHaveBeenCalled();
  });

  it("accept invite: a token the server rejects shows the expired message", async () => {
    signedOut();
    server.use(
      http.post("/api/v1/invites/inspect", () =>
        apiError(404, "not_found", "Link is invalid or has expired"),
      ),
    );
    withHash("/accept-invite", "#token=anc_inv_used");
    await renderApp("/accept-invite");
    expect(
      await screen.findByText("This invite link is invalid or has expired"),
    ).toBeInTheDocument();
  });
});

describe("/reset-password", () => {
  it("reset password: token from fragment is sent in body, never in the URL", async () => {
    signedOut();
    const reset = vi.fn(async ({ request }: { request: Request }) => {
      expect(request.url).not.toContain("anc_rst_");
      expect(await request.json()).toEqual({ token: "anc_rst_xyz789", password: STRONG });
      return new HttpResponse(null, { status: 204 });
    });
    server.use(http.post("/api/v1/auth/password-reset", reset));
    withHash("/reset-password", "#token=anc_rst_xyz789");
    const { router, user, queryClient } = await renderApp("/reset-password");
    expect(window.location.hash).toBe("");
    await user.type(await screen.findByLabelText("New password"), STRONG);
    await user.type(screen.getByLabelText("Confirm password"), STRONG);
    await user.click(screen.getByRole("button", { name: "Update password" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(reset).toHaveBeenCalledTimes(1);
    expectNotInMutationCache(queryClient, STRONG, "anc_rst_xyz789");
  });

  it("reset password: a missing token shows the invalid link message", async () => {
    signedOut();
    withHash("/reset-password", "");
    await renderApp("/reset-password");
    expect(
      await screen.findByText("This reset link is invalid or has expired"),
    ).toBeInTheDocument();
  });
});

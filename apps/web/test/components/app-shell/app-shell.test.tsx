import { screen, waitFor, within } from "@testing-library/react";
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

describe("auth guard", () => {
  it("unauthenticated visit to /projects redirects to /login?redirect=%2Fprojects", async () => {
    signedOut();
    const { router } = await renderApp("/projects");
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toEqual({ redirect: "/projects" });
    expect(router.state.location.href).toBe("/login?redirect=%2Fprojects");
  });

  it("fresh instance redirects to /setup", async () => {
    signedOut({ needsSetup: true });
    const { router } = await renderApp("/projects");
    await waitFor(() => expect(router.state.location.pathname).toBe("/setup"));
  });

  it("/ goes to /projects when signed in", async () => {
    signedInAs(fixtures.owner);
    projectExists();
    const { router } = await renderApp("/");
    await waitFor(() => expect(router.state.location.pathname).toBe("/projects"));
  });
});

describe("navigation", () => {
  it("owner sees Users and Audit log; member does not", async () => {
    signedInAs(fixtures.owner);
    projectExists();
    await renderApp("/projects");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Users" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Audit log" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Projects" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Account" })).toBeInTheDocument();
  });

  it("member does not see Users and Audit log", async () => {
    signedInAs(fixtures.member);
    projectExists();
    await renderApp("/projects");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).queryByRole("link", { name: "Users" })).toBeNull();
    expect(within(nav).queryByRole("link", { name: "Audit log" })).toBeNull();
  });

  it("project routes show the Project group and the environment card with the current env", async () => {
    signedInAs(fixtures.owner);
    projectExists();
    await renderApp("/projects/app/environments/staging");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(await within(nav).findByRole("link", { name: "Overview" })).toHaveAttribute(
      "href",
      "/projects/app",
    );
    expect(within(nav).getByRole("link", { name: "Secrets" })).toHaveAttribute(
      "href",
      "/projects/app/environments/staging",
    );
    expect(within(nav).getByRole("link", { name: "Service tokens" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Environment: Staging/ })).toBeInTheDocument();
  });

  it("outside a project the environment card asks to select a project", async () => {
    signedInAs(fixtures.owner);
    projectExists();
    await renderApp("/projects");
    expect(await screen.findByRole("link", { name: "Select a project" })).toHaveAttribute(
      "href",
      "/projects",
    );
    expect(screen.queryByRole("link", { name: "Overview" })).toBeNull();
  });

  it("switching environment navigates to the same view in the new env and persists the choice", async () => {
    signedInAs(fixtures.owner);
    projectExists();
    const { router, user } = await renderApp("/projects/app/environments/dev?path=%2Fapi");
    await user.click(await screen.findByRole("button", { name: /Environment: Development/ }));
    await user.click(await screen.findByRole("option", { name: /Production/ }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/projects/app/environments/prod"),
    );
    expect(router.state.location.search).toEqual({ path: "/api" });
    expect(window.localStorage.getItem("anchor.currentEnv")).toBe("prod");
  });

  it("the environment card only lists environments the caller can access", async () => {
    signedInAs(fixtures.member);
    projectExists({ ...fixtures.project, access: { role: "developer", environments: ["dev"] } });
    const { user } = await renderApp("/projects/app");
    await user.click(await screen.findByRole("button", { name: /Environment: Development/ }));
    const list = await screen.findByRole("listbox");
    expect(
      within(list)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual([expect.stringContaining("Development")]);
  });
});

describe("session", () => {
  it("a 401 from any page query redirects once to login with the current location; the query cache is empty afterwards", async () => {
    // The session is valid for the guard, then expires: every later request is a 401.
    let expired = false;
    server.use(
      http.get("/api/v1/auth/me", () =>
        expired
          ? apiError(401, "unauthenticated", "Authentication required")
          : HttpResponse.json({ user: fixtures.owner }),
      ),
    );
    // Both shell queries fail in the same tick, released once the spy is attached.
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = () => {
        expired = true;
        r();
      };
    });
    const expiredResponse = async () => {
      await gate;
      return apiError(401, "unauthenticated", "Authentication required");
    };
    server.use(
      http.get("/api/v1/projects/app", expiredResponse),
      http.get("/api/v1/projects/app/environments", expiredResponse),
    );
    const { router, queryClient } = await renderApp("/projects/app?path=%2Fapi");
    const navigate = vi.spyOn(router, "navigate");
    release();
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toEqual({ redirect: "/projects/app?path=%2Fapi" });
    expect(
      navigate.mock.calls.filter(([o]) => (o as { to?: string }).to === "/login"),
    ).toHaveLength(1);
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .every((q) => q.state.data === undefined),
    ).toBe(true);
  });

  it("log out clears cache and lands on /login", async () => {
    signedInAs(fixtures.owner);
    projectExists();
    const logout = vi.fn(() => {
      signedOut();
      return new HttpResponse(null, { status: 204 });
    });
    server.use(http.post("/api/v1/auth/logout", logout));
    const { router, user, queryClient } = await renderApp("/projects");
    await user.click(await screen.findByRole("button", { name: "Account menu" }));
    expect(await screen.findByText(fixtures.owner.email)).toBeInTheDocument();
    await user.click(await screen.findByRole("menuitem", { name: "Log out" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .every((q) => q.state.data === undefined),
    ).toBe(true);
  });
});

describe("header", () => {
  it("title appears in the header bar, not in content", async () => {
    signedInAs(fixtures.owner);
    projectExists();
    await renderApp("/projects");
    const header = await screen.findByRole("banner");
    expect(await within(header).findByRole("heading", { name: "Projects" })).toBeInTheDocument();
    const main = screen.getByRole("main");
    expect(within(main).queryByRole("heading", { name: "Projects" })).toBeNull();
  });
});

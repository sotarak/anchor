import type { OverviewDto } from "@anchor/shared";
import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { apiError, fixtures, projectExists, renderApp, server, signedInAs } from "#test/support";

const [dev, staging, prod] = fixtures.envs as [
  (typeof fixtures.envs)[number],
  (typeof fixtures.envs)[number],
  (typeof fixtures.envs)[number],
];
const cell = (version: number) => ({ version, updatedAt: fixtures.project.createdAt });
const full: OverviewDto = {
  environments: [dev, staging, prod],
  keys: [
    { key: "API_KEY", cells: { dev: cell(1), staging: cell(2), prod: cell(3) } },
    { key: "DATABASE_URL", cells: { dev: cell(1), staging: null, prod: cell(1) } },
  ],
  folders: [],
};
const withFolders: OverviewDto = {
  ...full,
  folders: [
    { path: "/api", name: "api", environments: { dev: true, staging: false, prod: true } },
    { path: "/db", name: "db", environments: { dev: true, staging: true, prod: true } },
  ],
};

/** Serves the overview and records the `path` query of each request. */
function overviewIs(body: OverviewDto | (() => Response)) {
  const paths: (string | null)[] = [];
  server.use(
    http.get("/api/v1/projects/app/overview", ({ request }) => {
      paths.push(new URL(request.url).searchParams.get("path"));
      return typeof body === "function" ? body() : HttpResponse.json(body);
    }),
  );
  return paths;
}

function setup(body: OverviewDto | (() => Response) = full) {
  signedInAs(fixtures.owner);
  projectExists();
  return overviewIs(body);
}

const columnNames = () =>
  screen.getAllByRole("columnheader").map((h) => h.textContent?.replace(/\s+/g, " ").trim());

describe("/projects/$project (overview)", () => {
  it("the header title is the project name", async () => {
    setup();
    await renderApp("/projects/app");
    const header = screen.getByRole("banner");
    expect(await within(header).findByRole("heading", { name: "App" })).toBeInTheDocument();
  });

  it("renders a column per environment returned by the API (restricted user sees only dev)", async () => {
    signedInAs(fixtures.member);
    projectExists({ ...fixtures.project, access: { role: "developer", environments: ["dev"] } });
    overviewIs({
      environments: [dev],
      keys: [{ key: "API_KEY", cells: { dev: cell(1) } }],
      folders: [],
    });
    await renderApp("/projects/app");
    await screen.findByText("API_KEY");
    expect(columnNames()).toEqual(["Key", "Development dev"]);
  });

  it("missing cells show the Missing badge; present cells show version tooltip", async () => {
    setup();
    const { user } = await renderApp("/projects/app");
    const row = (await screen.findByText("DATABASE_URL")).closest("tr") as HTMLElement;
    expect(within(row).getAllByText("Missing")).toHaveLength(1);
    expect(columnNames()).toEqual(["Key", "Development dev", "Staging staging", "Production prod"]);
    await user.hover(within(row).getByRole("link", { name: "DATABASE_URL in Production: v1" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(/^v1, updated /);
  });

  it('Status filter "Missing somewhere" hides complete rows; filtered-empty offers clear', async () => {
    setup();
    const { user } = await renderApp("/projects/app");
    await screen.findByText("API_KEY");
    await user.click(screen.getByRole("button", { name: "Status" }));
    await user.click(await screen.findByRole("checkbox", { name: "Missing somewhere" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByText("API_KEY")).toBeNull();
    expect(screen.getByText("DATABASE_URL")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Search keys" }));
    await user.type(screen.getByRole("searchbox", { name: "Search keys" }), "API");
    expect(await screen.findByText("No results match your filters")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByText("API_KEY")).toBeInTheDocument();
    expect(screen.getByText("DATABASE_URL")).toBeInTheDocument();
  });

  it("cell click navigates to the env page with path", async () => {
    setup();
    const { router, user } = await renderApp("/projects/app?path=%2Fapi");
    await user.click(await screen.findByRole("link", { name: "DATABASE_URL in Staging: missing" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/projects/app/environments/staging"),
    );
    expect(router.state.location.search).toEqual({ path: "/api" });
  });

  it("invalid path search param falls back to /", async () => {
    const paths = setup();
    await renderApp("/projects/app?path=..%2Fx");
    await screen.findByText("API_KEY");
    expect(paths).toEqual(["/"]);
  });

  it("the breadcrumb sets the path", async () => {
    const paths = setup();
    const { router, user } = await renderApp("/projects/app?path=%2Fapi%2Fv1");
    await screen.findByText("API_KEY");
    await user.click(screen.getByRole("button", { name: "api" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ path: "/api" }));
    await user.click(screen.getByRole("button", { name: "/" }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    await waitFor(() => expect(paths).toEqual(["/api/v1", "/api", "/"]));
  });

  it("empty path offers Add a secret in the current environment", async () => {
    setup({ environments: [dev, staging, prod], keys: [], folders: [] });
    const { router, user } = await renderApp("/projects/app?path=%2Fapi");
    await user.click(await screen.findByRole("button", { name: "Add a secret" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/projects/app/environments/dev"),
    );
    expect(router.state.location.search).toEqual({ path: "/api" });
  });

  it("folder rows come before keys with a mark per environment", async () => {
    setup(withFolders);
    await renderApp("/projects/app");
    const api = (await screen.findByRole("button", { name: "api" })).closest("tr") as HTMLElement;
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent?.match(/^(api|db|API_KEY|DATABASE_URL)/)?.[0])).toEqual([
      "api",
      "db",
      "API_KEY",
      "DATABASE_URL",
    ]);
    expect(within(api).getAllByText("Missing")).toHaveLength(1);
    expect(within(api).getAllByLabelText(/^api in .*: present$/)).toHaveLength(2);
  });

  it("clicking a folder row opens it", async () => {
    const paths = setup(withFolders);
    const { router, user } = await renderApp("/projects/app");
    const name = await screen.findByRole("button", { name: "api" });
    await user.click(name.closest("tr") as HTMLElement);
    await waitFor(() => expect(router.state.location.search).toEqual({ path: "/api" }));
    await waitFor(() => expect(paths).toEqual(["/", "/api"]));
  });

  it("a folder name is keyboard reachable", async () => {
    setup(withFolders);
    const { router, user } = await renderApp("/projects/app");
    const name = await screen.findByRole("button", { name: "db" });
    name.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(router.state.location.search).toEqual({ path: "/db" }));
  });

  it("a path with folders but no keys is not empty", async () => {
    setup({ ...withFolders, keys: [] });
    await renderApp("/projects/app");
    expect(await screen.findByRole("button", { name: "api" })).toBeInTheDocument();
    expect(screen.queryByText(/^Nothing in/)).toBeNull();
  });

  it("the empty state names the path", async () => {
    setup({ environments: [dev, staging, prod], keys: [], folders: [] });
    await renderApp("/projects/app");
    expect(await screen.findByText("Nothing in this project yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Secrets and folders you add to any environment show up here, one row per key or folder.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("No secrets at this path")).toBeNull();
  });

  it("the empty state of a subfolder names it", async () => {
    setup({ environments: [dev, staging, prod], keys: [], folders: [] });
    await renderApp("/projects/app?path=%2Fapi");
    expect(await screen.findByText("Nothing in /api yet")).toBeInTheDocument();
  });

  it("search matches folder names", async () => {
    setup(withFolders);
    const { user } = await renderApp("/projects/app");
    await screen.findByText("API_KEY");
    await user.click(screen.getByRole("button", { name: "Search keys" }));
    await user.type(screen.getByRole("searchbox", { name: "Search keys" }), "db");
    await waitFor(() => expect(screen.queryByText("API_KEY")).toBeNull());
    expect(screen.getByRole("button", { name: "db" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "api" })).toBeNull();
  });

  it("opening a folder found by search clears the filters", async () => {
    setup(withFolders);
    const { router, user } = await renderApp("/projects/app");
    await screen.findByText("API_KEY");
    await user.click(screen.getByRole("button", { name: "Search keys" }));
    await user.type(screen.getByRole("searchbox", { name: "Search keys" }), "db");
    await user.click(await screen.findByRole("button", { name: "db" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ path: "/db" }));
    // The subfolder's own rows show, not "No results match your filters".
    expect(await screen.findByText("API_KEY")).toBeInTheDocument();
    expect(screen.queryByText("No results match your filters")).toBeNull();
  });

  it('Status "Missing somewhere" hides a folder present everywhere', async () => {
    setup(withFolders);
    const { user } = await renderApp("/projects/app");
    await screen.findByText("API_KEY");
    await user.click(screen.getByRole("button", { name: "Status" }));
    await user.click(await screen.findByRole("checkbox", { name: "Missing somewhere" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "db" })).toBeNull();
    expect(screen.getByRole("button", { name: "api" })).toBeInTheDocument();
  });

  it("forbidden shows ForbiddenState", async () => {
    setup(() => apiError(403, "forbidden", "Forbidden"));
    await renderApp("/projects/app");
    expect(await screen.findByText("You don't have access to this project")).toBeInTheDocument();
  });

  it("no value text is ever rendered", async () => {
    setup();
    await renderApp("/projects/app");
    await screen.findByText("API_KEY");
    expect(document.body.textContent).not.toContain("••••");
    expect(columnNames()).not.toContain("Value");
  });
});

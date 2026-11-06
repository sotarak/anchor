import type { ProjectDto } from "@anchor/shared";
import { screen, waitFor, within } from "@testing-library/react";
import { delay, HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { apiError, fixtures, projectExists, renderApp, server, signedInAs } from "#test/support";

const billing: ProjectDto = {
  id: "p_billing",
  slug: "billing",
  name: "Billing",
  createdAt: fixtures.project.createdAt,
  access: { role: "viewer", environments: ["prod"] },
};

function projectsAre(projects: ProjectDto[]) {
  server.use(http.get("/api/v1/projects", () => HttpResponse.json({ projects })));
}

describe("/projects", () => {
  it("loading shows skeleton rows", async () => {
    signedInAs(fixtures.owner);
    server.use(http.get("/api/v1/projects", () => delay("infinite")));
    await renderApp("/projects");
    expect((await screen.findAllByTestId("skeleton-row")).length).toBeGreaterThan(0);
  });

  it("lists projects with role and created date", async () => {
    signedInAs(fixtures.owner);
    projectsAre([fixtures.project, billing]);
    await renderApp("/projects");
    const row = (await screen.findByText("Billing")).closest("tr") as HTMLElement;
    expect(within(row).getByText("billing")).toBeInTheDocument();
    expect(within(row).getByText("Viewer")).toBeInTheDocument();
    expect(within(row).getByText("Apr 2, 2026")).toBeInTheDocument();
    expect(screen.getByText("2 results")).toBeInTheDocument();
  });

  it("empty state for owner offers New project; for member explains to ask an admin", async () => {
    signedInAs(fixtures.owner);
    projectsAre([]);
    await renderApp("/projects");
    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New project" })).toHaveLength(1);
  });

  it("member empty state explains to ask an admin and offers no create", async () => {
    signedInAs(fixtures.member);
    projectsAre([]);
    await renderApp("/projects");
    expect(
      await screen.findByText("Ask an instance admin to add you to a project."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New project" })).toBeNull();
  });

  it("search filters and shows filtered-empty with Clear filters", async () => {
    signedInAs(fixtures.owner);
    projectsAre([fixtures.project, billing]);
    const { user } = await renderApp("/projects");
    await screen.findByText("Billing");
    await user.click(screen.getByRole("button", { name: "Search projects" }));
    await user.type(screen.getByRole("searchbox", { name: "Search projects" }), "bill");
    expect(screen.getByText("Billing")).toBeInTheDocument();
    expect(screen.queryByText("App")).toBeNull();
    await user.type(screen.getByRole("searchbox", { name: "Search projects" }), "zzz");
    expect(await screen.findByText("No results match your search")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByText("App")).toBeInTheDocument();
    expect(screen.getByText("Billing")).toBeInTheDocument();
  });

  it("create derives slug, submits, and navigates to the overview", async () => {
    signedInAs(fixtures.owner);
    projectsAre([fixtures.project]);
    const created: ProjectDto = {
      ...fixtures.project,
      id: "p_new",
      slug: "my-cool-app",
      name: "My Cool App!",
    };
    projectExists(created);
    projectsAre([fixtures.project]);
    const create = vi.fn(async ({ request }: { request: Request }) => {
      expect(await request.json()).toEqual({ name: "My Cool App!", slug: "my-cool-app" });
      return HttpResponse.json({ project: created }, { status: 201 });
    });
    server.use(http.post("/api/v1/projects", create));
    const { router, user } = await renderApp("/projects");
    await user.click(await screen.findByRole("button", { name: "New project" }));
    const sheet = await screen.findByRole("dialog");
    await user.type(within(sheet).getByLabelText("Name"), "My Cool App!");
    expect(within(sheet).getByLabelText("Slug")).toHaveValue("my-cool-app");
    await user.click(within(sheet).getByRole("button", { name: "Create project" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/projects/my-cool-app"));
    expect(create).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("an edited slug is no longer derived from the name", async () => {
    signedInAs(fixtures.owner);
    projectsAre([]);
    const { user } = await renderApp("/projects");
    await user.click(await screen.findByRole("button", { name: "New project" }));
    const sheet = await screen.findByRole("dialog");
    const slug = within(sheet).getByLabelText("Slug");
    await user.type(within(sheet).getByLabelText("Name"), "Web");
    await user.clear(slug);
    await user.type(slug, "custom");
    await user.type(within(sheet).getByLabelText("Name"), " App");
    expect(slug).toHaveValue("custom");
  });

  it("slug conflict shows a field error", async () => {
    signedInAs(fixtures.owner);
    projectsAre([fixtures.project]);
    server.use(
      http.post("/api/v1/projects", () => apiError(409, "conflict", "Project slug already exists")),
    );
    const { user } = await renderApp("/projects");
    await user.click(await screen.findByRole("button", { name: "New project" }));
    const sheet = await screen.findByRole("dialog");
    await user.type(within(sheet).getByLabelText("Name"), "App");
    await user.click(within(sheet).getByRole("button", { name: "Create project" }));
    expect(await within(sheet).findByText("Slug already in use")).toBeInTheDocument();
    expect(within(sheet).getByLabelText("Slug")).toHaveAttribute("aria-invalid", "true");
  });

  it("server error shows ErrorState with retry", async () => {
    signedInAs(fixtures.owner);
    let calls = 0;
    server.use(
      http.get("/api/v1/projects", () => {
        calls += 1;
        return calls === 1
          ? apiError(500, "internal", "Internal error")
          : HttpResponse.json({ projects: [fixtures.project] });
      }),
    );
    const { user } = await renderApp("/projects");
    expect(await screen.findByText("Couldn't load this page")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("App")).toBeInTheDocument();
  });

  it("row click opens the project", async () => {
    signedInAs(fixtures.owner);
    projectExists();
    const { router, user } = await renderApp("/projects");
    await user.click(await screen.findByText("App"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/projects/app"));
  });

  it("paginates 10 per page on the client", async () => {
    signedInAs(fixtures.owner);
    projectsAre(
      Array.from({ length: 12 }, (_, i) => ({
        ...fixtures.project,
        id: `p_${i}`,
        slug: `proj-${String(i).padStart(2, "0")}`,
        name: `Project ${String(i).padStart(2, "0")}`,
      })),
    );
    const { user } = await renderApp("/projects");
    expect(await screen.findByText("Project 00")).toBeInTheDocument();
    expect(screen.queryByText("Project 10")).toBeNull();
    expect(screen.getByText("12 results")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Project 11")).toBeInTheDocument();
    expect(screen.queryByText("Project 00")).toBeNull();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });
});

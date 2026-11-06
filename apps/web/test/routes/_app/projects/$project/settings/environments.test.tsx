import type { EnvironmentDto } from "@anchor/shared";
import { screen, waitFor, within } from "@testing-library/react";
import { delay, HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { apiError, fixtures, projectExists, renderApp, server, signedInAs } from "#test/support";

const URL_ = "/api/v1/projects/app/environments";
const PAGE = "/projects/app/settings/environments";

/** Serves the env list from a mutable array so refetches see changes. */
function envStore(initial: EnvironmentDto[] = fixtures.envs) {
  const store = { envs: [...initial], gets: 0 };
  server.use(
    http.get(URL_, () => {
      store.gets += 1;
      return HttpResponse.json({ environments: store.envs });
    }),
  );
  return store;
}

function setup(role: "admin" | "developer" = "admin", envs?: EnvironmentDto[]) {
  signedInAs(role === "admin" ? fixtures.owner : fixtures.member);
  projectExists({ ...fixtures.project, access: { role, environments: null } });
  return envStore(envs);
}

const rowNames = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell")[0]?.textContent);

async function openMenu(user: Awaited<ReturnType<typeof renderApp>>["user"], name: string) {
  const row = (await screen.findByText(name, { selector: "td *" })).closest("tr") as HTMLElement;
  await user.click(within(row).getByRole("button", { name: `Actions for ${name}` }));
}

describe("/projects/$project/settings/environments", () => {
  it("lists environments in position order", async () => {
    const [dev, staging, prod] = fixtures.envs as [EnvironmentDto, EnvironmentDto, EnvironmentDto];
    setup("admin", [prod, dev, staging]);
    await renderApp(PAGE);
    await screen.findByText("Production", { selector: "td *" });
    expect(rowNames()).toEqual(["Developmentdev", "Stagingstaging", "Productionprod"]);
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("heading", { name: "Environments" })).toBeInTheDocument();
  });

  it("create calls the API and refreshes", async () => {
    const store = setup();
    const create = vi.fn(async ({ request }: { request: Request }) => {
      expect(await request.json()).toEqual({ name: "QA Lab", slug: "qa-lab" });
      const env = { id: "e_qa", slug: "qa-lab", name: "QA Lab", position: 3 };
      store.envs.push(env);
      return HttpResponse.json({ environment: env }, { status: 201 });
    });
    server.use(http.post(URL_, create));
    const { user } = await renderApp(PAGE);
    await user.click(await screen.findByRole("button", { name: "New environment" }));
    const sheet = await screen.findByRole("dialog");
    await user.type(within(sheet).getByLabelText("Name"), "QA Lab");
    expect(within(sheet).getByLabelText("Slug")).toHaveValue("qa-lab");
    await user.click(within(sheet).getByRole("button", { name: "Create environment" }));
    expect(await screen.findByText("QA Lab", { selector: "td *" })).toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("a slug conflict on create shows a field error", async () => {
    setup();
    server.use(http.post(URL_, () => apiError(409, "conflict", "Environment slug already exists")));
    const { user } = await renderApp(PAGE);
    await user.click(await screen.findByRole("button", { name: "New environment" }));
    const sheet = await screen.findByRole("dialog");
    await user.type(within(sheet).getByLabelText("Name"), "Dev");
    await user.click(within(sheet).getByRole("button", { name: "Create environment" }));
    expect(await within(sheet).findByText("Slug already in use")).toBeInTheDocument();
  });

  it("rename calls the API and refreshes", async () => {
    const store = setup();
    const rename = vi.fn(async ({ request }: { request: Request }) => {
      expect(await request.json()).toEqual({ name: "Prod (EU)" });
      const env = { ...(store.envs[2] as EnvironmentDto), name: "Prod (EU)" };
      store.envs[2] = env;
      return HttpResponse.json({ environment: env });
    });
    server.use(http.patch(`${URL_}/prod`, rename));
    const { user } = await renderApp(PAGE);
    await openMenu(user, "Production");
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const sheet = await screen.findByRole("dialog");
    const name = within(sheet).getByLabelText("Name");
    expect(name).toHaveValue("Production");
    await user.clear(name);
    await user.type(name, "Prod (EU)");
    await user.click(within(sheet).getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Prod (EU)", { selector: "td *" })).toBeInTheDocument();
    expect(rename).toHaveBeenCalledTimes(1);
  });

  it("delete confirms with the secrets warning, calls the API and refreshes", async () => {
    const store = setup();
    const remove = vi.fn(() => {
      store.envs = store.envs.filter((e) => e.slug !== "staging");
      return new HttpResponse(null, { status: 204 });
    });
    server.use(http.delete(`${URL_}/staging`, remove));
    const { user } = await renderApp(PAGE);
    await openMenu(user, "Staging");
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete environment Staging" });
    expect(dialog).toHaveTextContent("Deletes every secret in Staging");
    await user.click(within(dialog).getByRole("button", { name: "Delete environment" }));
    await waitFor(() => expect(screen.queryByText("Staging", { selector: "td *" })).toBeNull());
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("deleting the last environment shows the server conflict message", async () => {
    setup("admin", [fixtures.envs[0] as EnvironmentDto]);
    server.use(
      http.delete(`${URL_}/dev`, () =>
        apiError(409, "conflict", "A project must keep at least one environment"),
      ),
    );
    const { user } = await renderApp(PAGE);
    await openMenu(user, "Development");
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete environment Development" });
    await user.click(within(dialog).getByRole("button", { name: "Delete environment" }));
    expect(
      await screen.findByText("A project must keep at least one environment"),
    ).toBeInTheDocument();
  });

  it("non-admin sees no actions", async () => {
    setup("developer");
    await renderApp(PAGE);
    await screen.findByText("Production", { selector: "td *" });
    expect(screen.queryByRole("button", { name: "New environment" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Actions for/ })).toBeNull();
  });

  it("loading shows skeleton rows", async () => {
    signedInAs(fixtures.owner);
    projectExists();
    server.use(http.get(URL_, () => delay("infinite")));
    await renderApp(PAGE);
    expect((await screen.findAllByTestId("skeleton-row")).length).toBeGreaterThan(0);
  });

  it("empty state offers New environment to admins", async () => {
    setup("admin", []);
    await renderApp(PAGE);
    expect(await screen.findByText("No environments")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New environment" })).toHaveLength(1);
  });

  it("error state retries", async () => {
    signedInAs(fixtures.owner);
    projectExists();
    let calls = 0;
    server.use(
      http.get(URL_, () => {
        calls += 1;
        return calls === 1
          ? apiError(500, "internal", "Internal error")
          : HttpResponse.json({ environments: fixtures.envs });
      }),
    );
    const { user } = await renderApp(PAGE);
    await user.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Production", { selector: "td *" })).toBeInTheDocument();
  });
});

import type { FolderDto, SecretDto } from "@anchor/shared";
import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import {
  apiError,
  fixtures,
  foldersAre,
  projectExists,
  renderApp,
  server,
  signedInAs,
} from "#test/support";

const base = "/api/v1/projects/app/environments/dev";
const api: FolderDto = { path: "/api", name: "api" };
const web: FolderDto = { path: "/web", name: "web" };

/** Secrets per path for dev; records list URLs. */
function secretsByPath(byPath: Record<string, SecretDto[]>) {
  const urls: URL[] = [];
  server.use(
    http.get(`${base}/secrets`, ({ request }) => {
      const url = new URL(request.url);
      urls.push(url);
      return HttpResponse.json({ secrets: byPath[url.searchParams.get("path") ?? "/"] ?? [] });
    }),
  );
  return { urls };
}

function setup(
  opts: { folders?: Record<string, FolderDto[]>; secrets?: Record<string, SecretDto[]> } = {},
) {
  signedInAs(fixtures.owner);
  projectExists();
  const folders = foldersAre("dev", opts.folders ?? { "/": [api, web] });
  const secrets = secretsByPath(opts.secrets ?? { "/": fixtures.secrets });
  return { folders, secrets };
}

const bodyRows = () => screen.getAllByRole("row").slice(1);

describe("folders in the environment view", () => {
  it("renders folder rows before secrets and navigates on click", async () => {
    const { secrets } = setup({
      folders: { "/": [api, web], "/api": [] },
      secrets: { "/": fixtures.secrets, "/api": [] },
    });
    const { user, router } = await renderApp("/projects/app/environments/dev");
    await screen.findByText("API_KEY");
    const rows = bodyRows();
    expect(within(rows[0] as HTMLElement).getByText("api")).toBeInTheDocument();
    // One line: the path is already in the breadcrumb.
    expect(within(rows[0] as HTMLElement).queryByText("/api")).toBeNull();
    expect(within(rows[1] as HTMLElement).getByText("web")).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText("API_KEY")).toBeInTheDocument();

    await user.click(within(rows[0] as HTMLElement).getByText("api"));
    expect(await screen.findByText("Secrets in /api")).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ path: "/api" });
    await waitFor(() =>
      expect(secrets.urls.some((u) => u.searchParams.get("path") === "/api")).toBe(true),
    );
  });

  it("breadcrumb segments link to ancestors", async () => {
    setup({ folders: {}, secrets: { "/api/v1": fixtures.secrets, "/api": fixtures.secrets } });
    const { user, router } = await renderApp("/projects/app/environments/dev?path=%2Fapi%2Fv1");
    const crumbs = within(await screen.findByRole("navigation", { name: "Path" }));
    expect(crumbs.getByRole("button", { name: "v1" })).toHaveAttribute("aria-current", "location");
    await user.click(crumbs.getByRole("button", { name: "api" }));
    expect(await screen.findByText("Secrets in /api")).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ path: "/api" });
    await user.click(crumbs.getByRole("button", { name: "/" }));
    expect(await screen.findByText("Secrets in /")).toBeInTheDocument();
  });

  it("new folder sheet validates path with shared schema", async () => {
    setup({ folders: { "/api": [] }, secrets: { "/api": fixtures.secrets } });
    const posted: unknown[] = [];
    server.use(
      http.post(`${base}/folders`, async ({ request }) => {
        posted.push(await request.json());
        return HttpResponse.json({ folder: { path: "/api/v2", name: "v2" } }, { status: 201 });
      }),
    );
    const { user } = await renderApp("/projects/app/environments/dev?path=%2Fapi");
    await screen.findByText("API_KEY");
    await user.click(screen.getByRole("button", { name: "More create options" }));
    await user.click(await screen.findByRole("menuitem", { name: "New folder" }));
    const sheet = within(await screen.findByRole("dialog", { name: "New folder" }));
    expect(sheet.getByText("Created inside /api.")).toBeInTheDocument();

    await user.type(sheet.getByLabelText("Name"), "bad name");
    await user.click(sheet.getByRole("button", { name: "Create folder" }));
    expect(
      await sheet.findByText("Use letters, digits, '_' or '-', separated by '/'"),
    ).toBeInTheDocument();
    expect(posted).toEqual([]);

    await user.clear(sheet.getByLabelText("Name"));
    await user.type(sheet.getByLabelText("Name"), "v2");
    await user.click(sheet.getByRole("button", { name: "Create folder" }));
    await waitFor(() => expect(posted).toEqual([{ path: "/api/v2" }]));
    expect(await screen.findByText("Folder created")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "New folder" })).not.toBeInTheDocument(),
    );
  });

  it("delete 409 shows force confirmation naming the folder", async () => {
    setup();
    const deletes: URL[] = [];
    server.use(
      http.delete(`${base}/folders`, ({ request }) => {
        const url = new URL(request.url);
        deletes.push(url);
        return url.searchParams.get("force") === "true"
          ? new HttpResponse(null, { status: 204 })
          : apiError(409, "conflict", "Folder is not empty");
      }),
    );
    const { user } = await renderApp("/projects/app/environments/dev");
    const row = (await screen.findByText("web")).closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Actions for folder web" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete folder" }));

    const first = within(await screen.findByRole("dialog", { name: "Delete folder web" }));
    await user.click(first.getByRole("button", { name: "Delete folder" }));
    const force = within(
      await screen.findByRole("dialog", { name: "Delete /web and everything in it" }),
    );
    expect(force.getByText(/every secret and subfolder inside/)).toBeInTheDocument();
    await user.click(force.getByRole("button", { name: "Delete everything" }));
    expect(await screen.findByText("Folder deleted")).toBeInTheDocument();
    expect(deletes.map((u) => [u.searchParams.get("path"), u.searchParams.get("force")])).toEqual([
      ["/web", "false"],
      ["/web", "true"],
    ]);
  });

  it("empty state copy names the path", async () => {
    setup({ folders: { "/api": [] }, secrets: { "/api": [] } });
    await renderApp("/projects/app/environments/dev?path=%2Fapi");
    expect(await screen.findByText("No secrets or folders in /api")).toBeInTheDocument();
  });

  it("search filters folders by name too", async () => {
    setup();
    const { user } = await renderApp("/projects/app/environments/dev");
    await screen.findByText("API_KEY");
    await user.click(screen.getByRole("button", { name: "Search keys" }));
    await user.type(screen.getByRole("searchbox", { name: "Search keys" }), "we");
    await waitFor(() => expect(screen.queryByText("API_KEY")).not.toBeInTheDocument());
    expect(screen.getByText("web")).toBeInTheDocument();
    expect(screen.queryByText("api")).not.toBeInTheDocument();
  });

  it("a viewer sees no folder actions and no create menu", async () => {
    signedInAs(fixtures.owner);
    projectExists({ ...fixtures.project, access: { role: "viewer", environments: null } });
    foldersAre("dev", { "/": [api] });
    secretsByPath({ "/": fixtures.secrets });
    await renderApp("/projects/app/environments/dev");
    const row = (await screen.findByText("api")).closest("tr") as HTMLElement;
    expect(within(row).queryByRole("button", { name: "Actions for folder api" })).toBeNull();
    expect(screen.queryByRole("button", { name: "More create options" })).toBeNull();
  });
});

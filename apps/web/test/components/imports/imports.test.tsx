import type { FolderImportDto, SecretDto } from "@anchor/shared";
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
const shared: FolderImportDto = {
  id: "imp_1",
  path: "/",
  source: { environment: "prod", path: "/shared" },
  position: 1,
};
const imported: SecretDto = {
  key: "SHARED_URL",
  path: "/shared",
  version: 4,
  comment: "",
  updatedAt: Date.UTC(2026, 3, 2),
  importedFrom: { environment: "prod", path: "/shared" },
};

function setup(opts: { imports?: FolderImportDto[]; secrets?: SecretDto[] | Response } = {}) {
  signedInAs(fixtures.owner);
  projectExists();
  foldersAre("dev");
  let imports = opts.imports ?? [shared];
  const listUrls: URL[] = [];
  const getUrls: URL[] = [];
  const posted: unknown[] = [];
  const deleted: string[] = [];
  let importGets = 0;
  server.use(
    http.get(`${base}/secrets`, ({ request }) => {
      listUrls.push(new URL(request.url));
      if (opts.secrets instanceof Response) return opts.secrets.clone();
      return HttpResponse.json({ secrets: opts.secrets ?? [...fixtures.secrets, imported] });
    }),
    http.get(`${base}/secrets/:key`, ({ request, params }) => {
      getUrls.push(new URL(request.url));
      return HttpResponse.json({ secret: { ...imported, key: params.key, value: "v" } });
    }),
    http.get(`${base}/imports`, () => {
      importGets++;
      return HttpResponse.json({ imports });
    }),
    http.post(`${base}/imports`, async ({ request }) => {
      const body = await request.json();
      posted.push(body);
      if (posted.length === 1) {
        return apiError(409, "conflict", "This folder already imports prod:/shared");
      }
      return HttpResponse.json({ import: { ...shared, id: "imp_2" } }, { status: 201 });
    }),
    http.delete(`${base}/imports/:id`, ({ params }) => {
      deleted.push(params.id as string);
      imports = [];
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return { listUrls, getUrls, posted, deleted, importGets: () => importGets };
}

const rowOf = async (key: string) => (await screen.findByText(key)).closest("tr") as HTMLElement;

describe("imports in the environment view", () => {
  it("imported rows tagged and read-only", async () => {
    const { listUrls, getUrls } = setup();
    const { user } = await renderApp("/projects/app/environments/dev");
    const row = await rowOf("SHARED_URL");
    const tag = within(row).getByText("from prod:/shared");
    await user.hover(tag);
    await waitFor(() =>
      expect(screen.getAllByRole("tooltip").map((t) => t.textContent)).toContain(
        "Edit in prod:/shared",
      ),
    );
    await user.unhover(tag);
    await user.click(within(row).getByRole("button", { name: "Actions for SHARED_URL" }));
    const menu = within(await screen.findByRole("menu"));
    expect(menu.getByRole("menuitem", { name: "Copy key" })).toBeInTheDocument();
    for (const name of ["Edit", "Delete", "History"]) {
      expect(menu.queryByRole("menuitem", { name })).toBeNull();
    }
    await user.keyboard("{Escape}");
    await user.click(within(row).getByRole("button", { name: "Reveal value" }));
    await waitFor(() => expect(getUrls).toHaveLength(1));
    expect(getUrls[0]?.searchParams.get("includeImports")).toBe("true");
    expect(listUrls.every((u) => u.searchParams.get("includeImports") === "true")).toBe(true);
  });

  it("local key shadows imported key (only local row shown)", async () => {
    setup({ secrets: fixtures.secrets });
    await renderApp("/projects/app/environments/dev");
    const row = await rowOf("API_KEY");
    expect(screen.getAllByText("API_KEY")).toHaveLength(1);
    expect(within(row).queryByText(/^from /)).toBeNull();
  });

  it("add import validates path and posts", async () => {
    const { posted } = setup({ imports: [] });
    const { user } = await renderApp("/projects/app/environments/dev");
    await screen.findByText("API_KEY");
    await user.click(screen.getByRole("button", { name: "More create options" }));
    await user.click(await screen.findByRole("menuitem", { name: "Add import" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Add import" }));
    await user.click(sheet.getByRole("combobox", { name: "Source environment" }));
    await user.click(await screen.findByRole("option", { name: "Production" }));
    await user.type(sheet.getByLabelText("Source path"), "bad path");
    await user.click(sheet.getByRole("button", { name: "Add import" }));
    expect(
      await sheet.findByText("Use /folder/sub with letters, digits, '_' or '-'"),
    ).toBeInTheDocument();
    expect(posted).toEqual([]);

    await user.clear(sheet.getByLabelText("Source path"));
    await user.type(sheet.getByLabelText("Source path"), "/shared");
    await user.click(sheet.getByRole("button", { name: "Add import" }));
    expect(await sheet.findByText("This folder already imports prod:/shared")).toBeInTheDocument();
    await user.click(sheet.getByRole("button", { name: "Add import" }));
    expect(await screen.findByText("Import added")).toBeInTheDocument();
    expect(posted).toEqual([
      { path: "/", source: { environment: "prod", path: "/shared" } },
      { path: "/", source: { environment: "prod", path: "/shared" } },
    ]);
  });

  it("403 from list renders error state, not partial rows", async () => {
    const message = "You do not have permission to read the import prod:/shared of dev:/";
    setup({ secrets: apiError(403, "forbidden", message) });
    await renderApp("/projects/app/environments/dev");
    expect(await screen.findByText("You cannot read an imported folder")).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByText("API_KEY")).toBeNull();
  });

  it("remove import confirms and invalidates", async () => {
    const { deleted, importGets } = setup();
    const { user } = await renderApp("/projects/app/environments/dev");
    const section = within(
      (await screen.findByText("Imported from")).closest("section") as HTMLElement,
    );
    expect(section.getByText("prod:/shared")).toBeInTheDocument();
    const before = importGets();
    await user.click(section.getByRole("button", { name: "Actions for import prod:/shared" }));
    await user.click(await screen.findByRole("menuitem", { name: "Remove import" }));
    const dialog = within(
      await screen.findByRole("dialog", { name: "Remove import prod:/shared" }),
    );
    await user.click(dialog.getByRole("button", { name: "Remove import" }));
    expect(await screen.findByText("Import removed")).toBeInTheDocument();
    expect(deleted).toEqual(["imp_1"]);
    await waitFor(() => expect(screen.queryByText("Imported from")).toBeNull());
    expect(importGets()).toBeGreaterThan(before);
  });

  it("the section is hidden when there are no imports", async () => {
    setup({ imports: [], secrets: fixtures.secrets });
    await renderApp("/projects/app/environments/dev");
    await screen.findByText("API_KEY");
    expect(screen.queryByText("Imported from")).toBeNull();
  });
});

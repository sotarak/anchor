import type { ProjectDto, SecretDto } from "@anchor/shared";
import { act, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import {
  apiError,
  fixtures,
  foldersAre,
  projectExists,
  renderApp,
  server,
  signedInAs,
} from "#test/support";

const CANARY = "SECRETS-VIEW-CANARY-7f3";
const MASK = "••••••••";
const base = "/api/v1/projects/app/environments";

/** Serves list + single GET for one env; records list URLs and single-GET count. */
function secretsAre(env: string, secrets: SecretDto[] = fixtures.secrets) {
  const listUrls: URL[] = [];
  const get = vi.fn(({ params }: { params: Record<string, string | readonly string[]> }) => {
    const found = secrets.find((s) => s.key === params.key);
    return found
      ? HttpResponse.json({ secret: { ...found, value: CANARY } })
      : apiError(404, "not_found", "Secret not found");
  });
  foldersAre(env);
  server.use(
    http.get(`${base}/${env}/secrets`, ({ request }) => {
      listUrls.push(new URL(request.url));
      return HttpResponse.json({ secrets });
    }),
    http.get(`${base}/${env}/secrets/:key`, get),
  );
  return { listUrls, get };
}

function setup(opts: { project?: ProjectDto; secrets?: SecretDto[] } = {}) {
  signedInAs(fixtures.owner);
  projectExists(opts.project ?? fixtures.project);
  return secretsAre("dev", opts.secrets);
}

async function rowOf(key: string) {
  return (await screen.findByText(key)).closest("tr") as HTMLElement;
}

async function openMenu(user: Awaited<ReturnType<typeof renderApp>>["user"], key: string) {
  await user.click(within(await rowOf(key)).getByRole("button", { name: `Actions for ${key}` }));
}

describe("/projects/$project/environments/$env", () => {
  it("header shows project and env; section label names the path", async () => {
    setup();
    await renderApp("/projects/app/environments/dev?path=%2Fapi");
    const header = screen.getByRole("banner");
    expect(
      await within(header).findByRole("heading", { name: "App / Development" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Secrets in /api")).toBeInTheDocument();
  });

  it("list shows keys with masked values; the list request has no reveal param", async () => {
    const { listUrls } = setup();
    await renderApp("/projects/app/environments/dev");
    const row = await rowOf("API_KEY");
    expect(within(row).getByText(MASK)).toBeInTheDocument();
    expect(within(row).getByText("Stripe key")).toBeInTheDocument();
    expect(within(row).getByText("v2")).toBeInTheDocument();
    expect(screen.getAllByText(MASK)).toHaveLength(2);
    expect(document.body.textContent).not.toContain(CANARY);
    expect(listUrls.length).toBeGreaterThan(0);
    for (const url of listUrls) expect(url.searchParams.has("reveal")).toBe(false);
  });

  it("shows the comment in its own column", async () => {
    setup();
    await renderApp("/projects/app/environments/dev");
    const row = await rowOf("API_KEY");
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Key", "Value", "Comment", "Version", "Updated", "Actions"]);
    const cells = within(row).getAllByRole("cell");
    expect(cells[0]).not.toHaveTextContent("Stripe key");
    expect(cells[2]).toHaveTextContent("Stripe key");
    const empty = within(await rowOf("DATABASE_URL")).getAllByRole("cell");
    expect(empty[2]).toHaveTextContent("–");
  });

  it("a long comment is truncated in its own column", async () => {
    const long = "c".repeat(300);
    setup({ secrets: [{ key: "LONG", path: "/", version: 1, comment: long, updatedAt: 0 }] });
    const { user } = await renderApp("/projects/app/environments/dev");
    const cell = within(await rowOf("LONG")).getAllByRole("cell")[2] as HTMLElement;
    const text = within(cell).getByText(long);
    expect(text.className).toMatch(/\btruncate\b/);
    expect(text.className).toMatch(/\bmax-w-/);
    await user.hover(text);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(long);
  });

  it("reveal calls GET secrets/:key once and shows the value; toggling re-masks", async () => {
    const { get } = setup();
    const { user } = await renderApp("/projects/app/environments/dev");
    const row = await rowOf("API_KEY");
    await user.click(within(row).getByRole("button", { name: "Reveal value" }));
    expect(await within(row).findByText(CANARY)).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(1);
    await user.click(within(row).getByRole("button", { name: "Hide value" }));
    expect(within(row).getByText(MASK)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(CANARY);
  });

  it("revealed value is not in the query cache", async () => {
    setup();
    const { user, queryClient } = await renderApp("/projects/app/environments/dev");
    const row = await rowOf("API_KEY");
    await user.click(within(row).getByRole("button", { name: "Reveal value" }));
    await within(row).findByText(CANARY);
    const cached = JSON.stringify(
      queryClient
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data),
    );
    expect(cached).not.toContain(CANARY);
    expect(
      JSON.stringify(
        queryClient
          .getMutationCache()
          .getAll()
          .map((m) => m.state),
      ),
    ).not.toContain(CANARY);
  });

  it("navigating to another env and back shows the value masked again", async () => {
    setup();
    secretsAre("staging");
    const { user, router } = await renderApp("/projects/app/environments/dev");
    const row = await rowOf("API_KEY");
    await user.click(within(row).getByRole("button", { name: "Reveal value" }));
    await within(row).findByText(CANARY);
    await act(() =>
      router.navigate({
        to: "/projects/$project/environments/$env",
        params: { project: "app", env: "staging" },
      }),
    );
    expect(await screen.findByRole("heading", { name: "App / Staging" })).toBeInTheDocument();
    await screen.findByText("API_KEY");
    expect(document.body.textContent).not.toContain(CANARY);
    await act(() =>
      router.navigate({
        to: "/projects/$project/environments/$env",
        params: { project: "app", env: "dev" },
      }),
    );
    expect(await screen.findByRole("heading", { name: "App / Development" })).toBeInTheDocument();
    expect(within(await rowOf("API_KEY")).getByText(MASK)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(CANARY);
  });

  it("changing to a cached path re-masks a revealed value (same page, new search)", async () => {
    setup();
    const { user, router } = await renderApp("/projects/app/environments/dev?path=%2Fapi");
    await screen.findByText("API_KEY");
    const go = (path?: string) =>
      act(() =>
        router.navigate({
          to: "/projects/$project/environments/$env",
          params: { project: "app", env: "dev" },
          search: path ? { path } : {},
        }),
      );
    await go();
    expect(await screen.findByText("Secrets in /")).toBeInTheDocument();
    const row = await rowOf("API_KEY");
    await user.click(within(row).getByRole("button", { name: "Reveal value" }));
    await within(row).findByText(CANARY);
    await go("/api"); // served from the cache: no loading state in between
    expect(await screen.findByText("Secrets in /api")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(CANARY);
  });

  it("copy fetches the value and writes it to the clipboard", async () => {
    const { get } = setup();
    const { user } = await renderApp("/projects/app/environments/dev");
    const row = await rowOf("API_KEY");
    await user.click(within(row).getByRole("button", { name: "Copy value" }));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(CANARY);
    expect(get).toHaveBeenCalledTimes(1);
    expect(within(row).getByText(MASK)).toBeInTheDocument();
  });

  it("add secret validates key (1BAD rejected client-side) and submits path from search", async () => {
    setup();
    const put = vi.fn(async ({ request }: { request: Request }) => {
      expect(await request.json()).toEqual({ value: "x", comment: "", path: "/api" });
      return HttpResponse.json(
        {
          secret: { key: "NEW_KEY", path: "/api", version: 1, comment: "", updatedAt: 0 },
          created: true,
        },
        { status: 201 },
      );
    });
    server.use(http.put(`${base}/dev/secrets/:key`, put));
    const { user } = await renderApp("/projects/app/environments/dev?path=%2Fapi");
    await screen.findByText("API_KEY");
    await user.click(screen.getByRole("button", { name: "Add secret" }));
    const sheet = await screen.findByRole("dialog");
    await user.type(within(sheet).getByLabelText("Key"), "1BAD");
    await user.type(within(sheet).getByLabelText("Value"), "x");
    await user.click(within(sheet).getByRole("button", { name: "Add secret" }));
    expect(
      await within(sheet).findByText("Use letters, digits and _; start with a letter or _"),
    ).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
    await user.clear(within(sheet).getByLabelText("Key"));
    await user.type(within(sheet).getByLabelText("Key"), "NEW_KEY");
    await user.click(within(sheet).getByRole("button", { name: "Add secret" }));
    expect(await screen.findByText("Secret saved")).toBeInTheDocument();
    expect(put).toHaveBeenCalledTimes(1);
    expect(new URL(put.mock.calls[0]?.[0].request.url as string).pathname).toBe(
      `${base}/dev/secrets/NEW_KEY`,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("add refuses a key that already exists at this path", async () => {
    setup();
    const put = vi.fn(() => HttpResponse.json({}));
    server.use(http.put(`${base}/dev/secrets/:key`, put));
    const { user } = await renderApp("/projects/app/environments/dev");
    await screen.findByText("API_KEY");
    await user.click(screen.getByRole("button", { name: "Add secret" }));
    const sheet = await screen.findByRole("dialog");
    await user.type(within(sheet).getByLabelText("Key"), "API_KEY");
    await user.type(within(sheet).getByLabelText("Value"), "x");
    await user.click(within(sheet).getByRole("button", { name: "Add secret" }));
    expect(
      await within(sheet).findByText("A secret with this key already exists here"),
    ).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
  });

  it("edit with untouched value re-sends the current value and the new comment", async () => {
    const { get } = setup();
    const put = vi.fn(async ({ request }: { request: Request }) => {
      expect(await request.json()).toEqual({ value: CANARY, comment: "Rotated", path: "/" });
      return HttpResponse.json({
        secret: { ...fixtures.secrets[0], version: 3, comment: "Rotated" },
        created: false,
      });
    });
    server.use(http.put(`${base}/dev/secrets/API_KEY`, put));
    const { user } = await renderApp("/projects/app/environments/dev");
    await openMenu(user, "API_KEY");
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByLabelText("Key")).toHaveValue("API_KEY");
    expect(within(sheet).getByLabelText("Key")).toHaveAttribute("readonly");
    expect(within(sheet).getByLabelText("Value")).toHaveValue("");
    const comment = within(sheet).getByLabelText("Comment");
    await user.clear(comment);
    await user.type(comment, "Rotated");
    await user.click(within(sheet).getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Secret saved")).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("a revealed value re-masks after the secret is edited (no stale plaintext)", async () => {
    signedInAs(fixtures.owner);
    projectExists(fixtures.project);
    let row0 = { ...(fixtures.secrets[0] as SecretDto) };
    let value = CANARY;
    const get = vi.fn(() => HttpResponse.json({ secret: { ...row0, value } }));
    foldersAre("dev");
    server.use(
      http.get(`${base}/dev/secrets`, () =>
        HttpResponse.json({ secrets: [row0, ...fixtures.secrets.slice(1)] }),
      ),
      http.get(`${base}/dev/secrets/:key`, get),
      http.put(`${base}/dev/secrets/API_KEY`, async ({ request }) => {
        value = ((await request.json()) as { value: string }).value;
        row0 = { ...row0, version: row0.version + 1 };
        return HttpResponse.json({ secret: row0, created: false });
      }),
    );
    const { user } = await renderApp("/projects/app/environments/dev");
    await user.click(within(await rowOf("API_KEY")).getByRole("button", { name: "Reveal value" }));
    expect(await within(await rowOf("API_KEY")).findByText(CANARY)).toBeInTheDocument();

    await openMenu(user, "API_KEY");
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
    const sheet = await screen.findByRole("dialog");
    await user.type(within(sheet).getByLabelText("Value"), "ROTATED-VALUE");
    await user.click(within(sheet).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const row = await rowOf("API_KEY");
    await waitFor(() => expect(within(row).getByText(`v${row0.version}`)).toBeInTheDocument());
    expect(within(row).getByText(MASK)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(CANARY);
    // Revealing again fetches the new value instead of reusing the old plaintext.
    await user.click(within(row).getByRole("button", { name: "Reveal value" }));
    expect(await within(row).findByText("ROTATED-VALUE")).toBeInTheDocument();
  });

  it("409 on save shows conflict toast and keeps the sheet open", async () => {
    setup();
    server.use(
      http.put(`${base}/dev/secrets/API_KEY`, () => apiError(409, "conflict", "Conflict")),
    );
    const { user } = await renderApp("/projects/app/environments/dev");
    await openMenu(user, "API_KEY");
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
    const sheet = await screen.findByRole("dialog");
    await user.type(within(sheet).getByLabelText("Value"), "new value");
    await user.click(within(sheet).getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText("This secret was changed elsewhere. Reload and try again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("413 on save shows the size error on the value field", async () => {
    setup();
    server.use(
      http.put(`${base}/dev/secrets/API_KEY`, () =>
        apiError(413, "payload_too_large", "Too large"),
      ),
    );
    const { user } = await renderApp("/projects/app/environments/dev");
    await openMenu(user, "API_KEY");
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
    const sheet = await screen.findByRole("dialog");
    await user.type(within(sheet).getByLabelText("Value"), "big");
    await user.click(within(sheet).getByRole("button", { name: "Save changes" }));
    expect(await within(sheet).findByText("Value is larger than 64 KiB")).toBeInTheDocument();
  });

  it("delete confirm names the key and calls DELETE with path", async () => {
    setup();
    const remove = vi.fn(() => new HttpResponse(null, { status: 204 }));
    server.use(http.delete(`${base}/dev/secrets/API_KEY`, remove));
    const { user } = await renderApp("/projects/app/environments/dev?path=%2Fapi");
    await openMenu(user, "API_KEY");
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete secret API_KEY" });
    expect(dialog).toHaveTextContent("Development");
    await user.click(within(dialog).getByRole("button", { name: "Delete secret" }));
    expect(await screen.findByText("Secret deleted")).toBeInTheDocument();
    expect(remove).toHaveBeenCalledTimes(1);
    const url = new URL((remove.mock.calls[0] as unknown as [{ request: Request }])[0].request.url);
    expect(url.searchParams.get("path")).toBe("/api");
  });

  it("viewer sees no Add button and no Edit/Delete items", async () => {
    setup({ project: { ...fixtures.project, access: { role: "viewer", environments: null } } });
    const { user } = await renderApp("/projects/app/environments/dev");
    await screen.findByText("API_KEY");
    expect(screen.queryByRole("button", { name: "Add secret" })).toBeNull();
    await openMenu(user, "API_KEY");
    expect(await screen.findByRole("menuitem", { name: "Copy key" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
  });

  it("a developer limited to other environments cannot add here", async () => {
    setup({
      project: { ...fixtures.project, access: { role: "developer", environments: ["staging"] } },
    });
    await renderApp("/projects/app/environments/dev");
    await screen.findByText("API_KEY");
    expect(screen.queryByRole("button", { name: "Add secret" })).toBeNull();
  });

  it("empty state at a path offers Add secret", async () => {
    setup({ secrets: [] });
    const { user } = await renderApp("/projects/app/environments/dev?path=%2Fapi");
    expect(await screen.findByText("No secrets or folders in /api")).toBeInTheDocument();
    const add = screen.getAllByRole("button", { name: "Add secret" });
    expect(add).toHaveLength(1);
    await user.click(add[0] as HTMLElement);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("filtered-empty clears the search", async () => {
    setup();
    const { user } = await renderApp("/projects/app/environments/dev");
    await screen.findByText("API_KEY");
    await user.click(screen.getByRole("button", { name: "Search keys" }));
    await user.type(screen.getByRole("searchbox", { name: "Search keys" }), "zzz");
    expect(await screen.findByText("No results match your search")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByText("API_KEY")).toBeInTheDocument();
  });
});

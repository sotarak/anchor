import type { ServiceTokenDto } from "@anchor/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { apiError, fixtures, projectExists, renderApp, server, signedInAs } from "#test/support";

const URL_ = "/api/v1/projects/app/service-tokens";
const PAGE = "/projects/app/settings/service-tokens";
const TOKEN = "anc_st_ONE-TIME-TOKEN-CANARY-55";
const DAY = 86_400_000;
const now = Date.now();
const active: ServiceTokenDto = {
  ...fixtures.serviceToken,
  id: "st_active",
  name: "ci-deploy",
  createdAt: now - DAY,
  expiresAt: now + 60 * DAY,
  lastUsedAt: now - 3_600_000,
};
const expiring: ServiceTokenDto = {
  ...active,
  id: "st_expiring",
  name: "nightly",
  tokenPrefix: "anc_st_cd34",
  permission: "read-write",
  scopes: [
    { environment: "dev", path: "/" },
    { environment: "staging", path: "/api" },
  ],
  expiresAt: now + 3 * DAY,
  lastUsedAt: null,
};
const revoked: ServiceTokenDto = {
  ...active,
  id: "st_revoked",
  name: "old-bot",
  revokedAt: now - DAY,
};

function setup(tokens: ServiceTokenDto[] = [active, expiring, revoked]) {
  signedInAs(fixtures.owner);
  projectExists();
  const store = { tokens: [...tokens] };
  server.use(http.get(URL_, () => HttpResponse.json({ serviceTokens: store.tokens })));
  return store;
}

async function rowOf(name: string) {
  return (await screen.findByText(name)).closest("tr") as HTMLElement;
}

type User = Awaited<ReturnType<typeof renderApp>>["user"];
async function pick(user: User, combobox: HTMLElement, option: RegExp) {
  await user.click(combobox);
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("/projects/$project/settings/service-tokens", () => {
  it("list shows status badges from tokenStatus (active, expiring, revoked)", async () => {
    setup();
    await renderApp(PAGE);
    const a = await rowOf("ci-deploy");
    expect(within(a).getByText("Active")).toBeInTheDocument();
    expect(within(a).getByText("anc_st_ab12…")).toBeInTheDocument();
    expect(within(a).getByText("Read")).toBeInTheDocument();
    expect(within(a).getByText("prod:/")).toBeInTheDocument();
    const e = await rowOf("nightly");
    expect(within(e).getByText("Expiring")).toBeInTheDocument();
    expect(within(e).getByText("Read & write")).toBeInTheDocument();
    expect(within(e).getByText("staging:/api")).toBeInTheDocument();
    expect(within(e).getByText("–")).toBeInTheDocument();
    expect(within(await rowOf("old-bot")).getByText("Revoked")).toBeInTheDocument();
    expect(
      within(screen.getByRole("banner")).getByRole("heading", { name: "Service tokens" }),
    ).toBeInTheDocument();
  });

  it("the footer counts one token in the singular", async () => {
    setup([active]);
    await renderApp(PAGE);
    await rowOf("ci-deploy");
    expect(screen.getByText("1 token")).toBeInTheDocument();
  });

  it("create sends scopes with env slugs and normalized paths", async () => {
    setup();
    const create = vi.fn(async ({ request }: { request: Request }) => {
      expect(await request.json()).toEqual({
        name: "deploy-bot",
        permission: "read-write",
        scopes: [
          { environment: "prod", path: "/api" },
          { environment: "staging", path: "/" },
        ],
        expiresInDays: 30,
      });
      return HttpResponse.json(
        { serviceToken: { ...active, id: "st_new", name: "deploy-bot" }, token: TOKEN },
        { status: 201 },
      );
    });
    server.use(http.post(URL_, create));
    const { user } = await renderApp(PAGE);
    await screen.findByText("ci-deploy");
    await user.click(screen.getByRole("button", { name: "New token" }));
    const sheet = await screen.findByRole("dialog");
    await user.type(within(sheet).getByLabelText("Name"), "deploy-bot");
    await pick(user, within(sheet).getByRole("combobox", { name: "Permission" }), /^Read & write/);
    await pick(
      user,
      within(sheet).getByRole("combobox", { name: "Environment for scope 1" }),
      /^Production/,
    );
    await user.clear(within(sheet).getByLabelText("Path for scope 1"));
    await user.type(within(sheet).getByLabelText("Path for scope 1"), "api/");
    await user.click(within(sheet).getByRole("button", { name: "Add scope" }));
    await pick(
      user,
      within(sheet).getByRole("combobox", { name: "Environment for scope 2" }),
      /^Staging/,
    );
    await pick(user, within(sheet).getByRole("combobox", { name: "Expires in" }), /^30 days/);
    await user.click(within(sheet).getByRole("button", { name: "Create token" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  });

  it("invalid scope path blocks submit", async () => {
    setup();
    const create = vi.fn(() => HttpResponse.json({}));
    server.use(http.post(URL_, create));
    const { user } = await renderApp(PAGE);
    await screen.findByText("ci-deploy");
    await user.click(screen.getByRole("button", { name: "New token" }));
    const sheet = await screen.findByRole("dialog");
    await user.type(within(sheet).getByLabelText("Name"), "bad");
    await user.clear(within(sheet).getByLabelText("Path for scope 1"));
    await user.type(within(sheet).getByLabelText("Path for scope 1"), "../x");
    await user.click(within(sheet).getByRole("button", { name: "Create token" }));
    expect(
      await within(sheet).findByText("Use folders of letters, digits, - and _, like /api/v1"),
    ).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it("removing a scope keeps at least one row", async () => {
    setup();
    const { user } = await renderApp(PAGE);
    await screen.findByText("ci-deploy");
    await user.click(screen.getByRole("button", { name: "New token" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("button", { name: "Remove scope 1" })).toBeDisabled();
    await user.click(within(sheet).getByRole("button", { name: "Add scope" }));
    await user.click(within(sheet).getByRole("button", { name: "Remove scope 2" }));
    expect(within(sheet).queryByLabelText("Path for scope 2")).toBeNull();
  });

  async function createToken() {
    const store = setup();
    server.use(
      http.post(URL_, () => {
        store.tokens.push({ ...active, id: "st_new", name: "deploy-bot" });
        return HttpResponse.json(
          { serviceToken: { ...active, id: "st_new", name: "deploy-bot" }, token: TOKEN },
          { status: 201 },
        );
      }),
    );
    const app = await renderApp(PAGE);
    await screen.findByText("ci-deploy");
    await app.user.click(screen.getByRole("button", { name: "New token" }));
    const sheet = await screen.findByRole("dialog");
    await app.user.type(within(sheet).getByLabelText("Name"), "deploy-bot");
    await app.user.click(within(sheet).getByRole("button", { name: "Create token" }));
    const dialog = await screen.findByRole("dialog", { name: "Copy your service token" });
    return { ...app, dialog };
  }

  it("after create the one-time dialog shows the token; Escape and outside click do not close it", async () => {
    const { user, dialog } = await createToken();
    expect(within(dialog).getByText(TOKEN)).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "This token is shown once. Store it in your CI secret store now.",
    );
    expect(dialog).toHaveTextContent("deploy-bot");
    await user.keyboard("{Escape}");
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    fireEvent.pointerDown(overlay as Element);
    fireEvent.click(overlay as Element);
    expect(screen.getByRole("dialog", { name: "Copy your service token" })).toBeInTheDocument();
    expect(screen.getByText(TOKEN)).toBeInTheDocument();
  });

  it("after Done the token is gone from the DOM and from the query cache", async () => {
    const { user, queryClient } = await createToken();
    await user.click(screen.getByRole("button", { name: "I've copied it" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Copy your service token" })).toBeNull(),
    );
    expect(await screen.findByText("deploy-bot")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(TOKEN);
    const cached = JSON.stringify(
      queryClient
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data),
    );
    expect(cached).not.toContain(TOKEN);
    const mutations = JSON.stringify(
      queryClient
        .getMutationCache()
        .getAll()
        .map((m) => m.state),
    );
    expect(mutations).not.toContain(TOKEN);
  });

  it("revoke confirm names the token and calls DELETE", async () => {
    const store = setup();
    const revoke = vi.fn(() => {
      store.tokens = store.tokens.map((t) =>
        t.id === "st_active" ? { ...t, revokedAt: Date.now() } : t,
      );
      return new HttpResponse(null, { status: 204 });
    });
    server.use(http.delete(`${URL_}/st_active`, revoke));
    const { user } = await renderApp(PAGE);
    await user.click(
      within(await rowOf("ci-deploy")).getByRole("button", { name: "Actions for ci-deploy" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Revoke" }));
    const dialog = await screen.findByRole("dialog", { name: "Revoke token ci-deploy" });
    await user.click(within(dialog).getByRole("button", { name: "Revoke token" }));
    await waitFor(() =>
      expect(
        within(screen.getByText("ci-deploy").closest("tr") as HTMLElement).getByText("Revoked"),
      ).toBeInTheDocument(),
    );
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("revoke is disabled for an already revoked token", async () => {
    setup();
    const { user } = await renderApp(PAGE);
    await user.click(
      within(await rowOf("old-bot")).getByRole("button", { name: "Actions for old-bot" }),
    );
    expect(await screen.findByRole("menuitem", { name: "Revoke" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("403 renders ForbiddenState", async () => {
    signedInAs(fixtures.member);
    projectExists({ ...fixtures.project, access: { role: "developer", environments: null } });
    server.use(http.get(URL_, () => apiError(403, "forbidden", "Forbidden")));
    await renderApp(PAGE);
    expect(
      await screen.findByText("You don't have access to this project's service tokens"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New token" })).toBeNull();
  });

  it("empty state offers New token", async () => {
    setup([]);
    await renderApp(PAGE);
    expect(await screen.findByText("No service tokens")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New token" })).toHaveLength(1);
  });

  it("filtered-empty for the status filter", async () => {
    setup([active]);
    const { user } = await renderApp(PAGE);
    await screen.findByText("ci-deploy");
    await user.click(screen.getByRole("button", { name: "Status" }));
    await user.click(await screen.findByRole("checkbox", { name: "Revoked" }));
    await user.keyboard("{Escape}");
    expect(await screen.findByText("No results match your filters")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByText("ci-deploy")).toBeInTheDocument();
  });
});

import type { AuditEventDto } from "@anchor/shared";
import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { apiError, fixtures, projectExists, renderApp, server, signedInAs } from "#test/support";

const [updated, read] = fixtures.auditEvents as [AuditEventDto, AuditEventDto];

/** Serves GET <url> from a function of the query; records every query string. */
function auditServes(
  url: string,
  respond: (
    q: URLSearchParams,
  ) => { events: AuditEventDto[]; nextCursor: string | null } | Response,
) {
  const queries: URLSearchParams[] = [];
  server.use(
    http.get(url, ({ request }) => {
      const q = new URL(request.url).searchParams;
      queries.push(q);
      const body = respond(q);
      return body instanceof Response ? body : HttpResponse.json(body);
    }),
  );
  return queries;
}

function asOwner() {
  signedInAs(fixtures.owner);
  projectExists();
  server.use(
    http.get("/api/v1/users", () =>
      HttpResponse.json({ users: [fixtures.owner, fixtures.member] }),
    ),
  );
}

const rowOf = async (text: string) =>
  (await screen.findByText(text, { selector: "td *, td" })).closest("tr") as HTMLElement;

describe("/audit", () => {
  it("renders events with action tags and actor labels", async () => {
    asOwner();
    auditServes("/api/v1/audit", () => ({ events: [updated, read], nextCursor: null }));
    await renderApp("/audit");
    const first = await rowOf("secret.updated");
    expect(within(first).getByText("owner@example.com")).toBeInTheDocument();
    expect(within(first).getByText("API_KEY")).toBeInTheDocument();
    expect(within(first).getByText("app")).toBeInTheDocument();
    expect(within(first).getByText("203.0.113.7")).toBeInTheDocument();
    const second = await rowOf("secret.read");
    expect(within(second).getByText("ci-deploy")).toBeInTheDocument();
    expect(within(second).getByText("Service token")).toBeInTheDocument();
    expect(within(second).getAllByText("–").length).toBeGreaterThan(0);
    expect(screen.getByText("2 shown")).toBeInTheDocument();
    expect(
      within(screen.getByRole("banner")).getByRole("heading", { name: "Audit log" }),
    ).toBeInTheDocument();
  });

  it("next page sends before=<nextCursor>; prev returns to the first page", async () => {
    asOwner();
    const queries = auditServes("/api/v1/audit", (q) =>
      q.get("before") === "cur_1"
        ? { events: [read], nextCursor: null }
        : { events: [updated], nextCursor: "cur_1" },
    );
    const { user } = await renderApp("/audit");
    await rowOf("secret.updated");
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await rowOf("secret.read");
    expect(queries.at(-1)?.get("before")).toBe("cur_1");
    expect(queries.at(-1)?.get("limit")).toBe("50");
    expect(screen.queryByText("secret.updated")).toBeNull();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    await rowOf("secret.updated");
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  });

  it("changing a filter resets pagination and updates the URL", async () => {
    asOwner();
    const queries = auditServes("/api/v1/audit", (q) =>
      q.get("before") === "cur_1"
        ? { events: [read], nextCursor: "cur_2" }
        : { events: [updated], nextCursor: "cur_1" },
    );
    const { user, router } = await renderApp("/audit");
    await rowOf("secret.updated");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await rowOf("secret.read");
    await user.click(screen.getByRole("button", { name: "Action" }));
    await user.click(await screen.findByRole("checkbox", { name: "secret.read" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ action: "secret.read" }));
    await waitFor(() => expect(queries.at(-1)?.get("action")).toBe("secret.read"));
    expect(queries.at(-1)?.has("before")).toBe(false);
    // A second pick replaces the first: the API filters by one action.
    await user.click(await screen.findByRole("checkbox", { name: "auth.login" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ action: "auth.login" }));
  });

  it("the actor filter lists users and sets actorId", async () => {
    asOwner();
    const queries = auditServes("/api/v1/audit", () => ({ events: [updated], nextCursor: null }));
    const { user, router } = await renderApp("/audit");
    await rowOf("secret.updated");
    await user.click(screen.getByRole("button", { name: "Actor" }));
    await user.click(await screen.findByRole("checkbox", { name: "Max Member" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ actorId: "u_member" }));
    await waitFor(() => expect(queries.at(-1)?.get("actorId")).toBe("u_member"));
  });

  it("an invalid search param is dropped", async () => {
    asOwner();
    const queries = auditServes("/api/v1/audit", () => ({ events: [updated], nextCursor: null }));
    await renderApp("/audit?action=nope&limit=7");
    await rowOf("secret.updated");
    expect(queries.at(-1)?.has("action")).toBe(false);
    expect(queries.at(-1)?.get("limit")).toBe("50");
  });

  it("labels targets by name or email", async () => {
    asOwner();
    const tokenCreated: AuditEventDto = {
      ...updated,
      id: "a_t",
      action: "service_token.created",
      target: "11111111-2222-3333-4444-555555555555",
      metadata: { name: "deploy-bot", permission: "read" },
    };
    const inviteCreated: AuditEventDto = {
      ...updated,
      id: "a_i",
      action: "invite.created",
      target: "66666666-7777-8888-9999-000000000000",
      metadata: { email: "dev@example.com", role: "member" },
    };
    const bare: AuditEventDto = {
      ...updated,
      id: "a_b",
      action: "user.updated",
      target: "u_bare",
      metadata: {},
    };
    auditServes("/api/v1/audit", () => ({
      events: [tokenCreated, inviteCreated, bare],
      nextCursor: null,
    }));
    const { user } = await renderApp("/audit");
    const cells = async (action: string) => within(await rowOf(action)).getAllByRole("cell");
    expect((await cells("service_token.created"))[3]).toHaveTextContent("deploy-bot");
    expect((await cells("invite.created"))[3]).toHaveTextContent("dev@example.com");
    expect((await cells("user.updated"))[3]).toHaveTextContent("u_bare");
    await user.click(await rowOf("service_token.created"));
    const sheet = await screen.findByRole("dialog", { name: "service_token.created" });
    expect(sheet).toHaveTextContent("11111111-2222-3333-4444-555555555555");
  });

  it("detail sheet shows metadata and never a value field", async () => {
    asOwner();
    auditServes("/api/v1/audit", () => ({ events: [updated], nextCursor: null }));
    const { user } = await renderApp("/audit");
    await user.click(await rowOf("secret.updated"));
    const sheet = await screen.findByRole("dialog", { name: "secret.updated" });
    expect(sheet).toHaveTextContent("req_2");
    expect(sheet).toHaveTextContent("Mozilla/5.0");
    expect(sheet).toHaveTextContent('"key": "API_KEY"');
    expect(within(sheet).queryByText(/^Value$/)).toBeNull();
    expect(within(sheet).queryByText("••••••••")).toBeNull();
  });

  it("project admin without instance role uses the project audit endpoint", async () => {
    signedInAs(fixtures.member);
    projectExists({ ...fixtures.project, access: { role: "admin", environments: null } });
    const queries = auditServes("/api/v1/projects/app/audit", () => ({
      events: [updated],
      nextCursor: null,
    }));
    await renderApp("/audit?projectId=p_app");
    await rowOf("secret.updated");
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.at(-1)?.has("projectId")).toBe(false);
    expect(screen.queryByRole("button", { name: "Actor" })).toBeNull();
  });

  it("project admins get a project Audit log link in the sidebar", async () => {
    signedInAs(fixtures.member);
    projectExists({ ...fixtures.project, access: { role: "admin", environments: null } });
    await renderApp("/projects/app/settings/environments");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(await within(nav).findByRole("link", { name: "Project audit log" })).toHaveAttribute(
      "href",
      "/audit?projectId=p_app",
    );
  });

  it("403 ForbiddenState", async () => {
    asOwner();
    auditServes("/api/v1/audit", () => apiError(403, "forbidden", "Forbidden"));
    await renderApp("/audit");
    expect(await screen.findByText("You don't have access to the audit log")).toBeInTheDocument();
  });

  it("a member without a project sees ForbiddenState without calling the API", async () => {
    signedInAs(fixtures.member);
    projectExists();
    await renderApp("/audit");
    expect(await screen.findByText("You don't have access to the audit log")).toBeInTheDocument();
  });

  it("empty state", async () => {
    asOwner();
    auditServes("/api/v1/audit", () => ({ events: [], nextCursor: null }));
    await renderApp("/audit");
    expect(await screen.findByText("No audit events yet")).toBeInTheDocument();
  });

  it("filtered-empty clears the filters", async () => {
    asOwner();
    auditServes("/api/v1/audit", (q) =>
      q.has("action") ? { events: [], nextCursor: null } : { events: [updated], nextCursor: null },
    );
    const { user, router } = await renderApp("/audit?action=auth.logout");
    expect(await screen.findByText("No results match your filters")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(await rowOf("secret.updated")).toBeInTheDocument();
  });
});

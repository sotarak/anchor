import type { InviteDto, UserDto } from "@anchor/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { apiError, fixtures, projectExists, renderApp, server, signedInAs } from "#test/support";

const DAY = 86_400_000;
const now = Date.now();
const me = fixtures.owner;
const oscar: UserDto = {
  id: "u_oscar",
  email: "oscar@example.com",
  name: "Oscar Owner",
  role: "owner",
  disabledAt: null,
};
const ada: UserDto = {
  id: "u_ada",
  email: "ada@example.com",
  name: "Ada Admin",
  role: "admin",
  disabledAt: null,
};
const max: UserDto = { ...fixtures.member, disabledAt: null };
const dan: UserDto = {
  id: "u_dan",
  email: "dan@example.com",
  name: "Dan Disabled",
  role: "member",
  disabledAt: now - DAY,
};
const pending: InviteDto = {
  ...fixtures.invite,
  id: "inv_pending",
  email: "new@example.com",
  expiresAt: now + 2 * DAY,
};
const accepted: InviteDto = {
  ...fixtures.invite,
  id: "inv_done",
  email: "joined@example.com",
  acceptedAt: now - DAY,
  expiresAt: now + DAY,
};
const INVITE_URL = "https://anchor.example/accept-invite#token=anc_inv_ONE-TIME-INVITE";
const RESET_URL = "https://anchor.example/reset-password#token=anc_rst_ONE-TIME-RESET";

function setup(
  users: UserDto[] = [{ ...me, disabledAt: null }, oscar, ada, max, dan],
  invites: InviteDto[] = [pending, accepted],
) {
  signedInAs(me);
  const store = { users: [...users], invites: [...invites] };
  server.use(
    http.get("/api/v1/users", () => HttpResponse.json({ users: store.users })),
    http.get("/api/v1/invites", () => HttpResponse.json({ invites: store.invites })),
  );
  return store;
}

async function rowOf(text: string) {
  return (await screen.findByText(text)).closest("tr") as HTMLElement;
}

type User = Awaited<ReturnType<typeof renderApp>>["user"];
async function openActions(user: User, name: string) {
  await user.click(within(await rowOf(name)).getByRole("button", { name: `Actions for ${name}` }));
}

function expectUndismissable(name: string) {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  const overlay = document.querySelector('[data-slot="dialog-overlay"]');
  fireEvent.pointerDown(overlay as Element);
  fireEvent.click(overlay as Element);
  expect(screen.getByRole("dialog", { name })).toBeInTheDocument();
}

describe("/users", () => {
  it("non-admin is redirected to /projects", async () => {
    signedInAs(fixtures.member);
    projectExists();
    const { router } = await renderApp("/users");
    await waitFor(() => expect(router.state.location.pathname).toBe("/projects"));
  });

  it("shows Users and Invites sections with their tables", async () => {
    setup();
    await renderApp("/users");
    expect(await screen.findByText("Ada Admin")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Invites" })).toBeInTheDocument();
    expect(within(await rowOf("Dan Disabled")).getByText("Disabled")).toBeInTheDocument();
    expect(within(await rowOf("Ada Admin")).getByText("Active")).toBeInTheDocument();
    expect(within(await rowOf("new@example.com")).getByText("Pending")).toBeInTheDocument();
    expect(within(await rowOf("joined@example.com")).getByText("Accepted")).toBeInTheDocument();
  });

  it("users list with role and status filters; filtered-empty", async () => {
    setup();
    const { user } = await renderApp("/users");
    await screen.findByText("Ada Admin");
    await user.click(screen.getByRole("button", { name: "Role" }));
    await user.click(await screen.findByRole("checkbox", { name: "Admin" }));
    await user.keyboard("{Escape}");
    expect(screen.getByText("Ada Admin")).toBeInTheDocument();
    expect(screen.queryByText("Max Member")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Status" }));
    await user.click(await screen.findByRole("checkbox", { name: "Disabled" }));
    await user.keyboard("{Escape}");
    expect(await screen.findByText("No results match your filters")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByText("Max Member")).toBeInTheDocument();
  });

  it("invite shows the one-time URL dialog that cannot be dismissed accidentally", async () => {
    const store = setup();
    const create = vi.fn(async ({ request }: { request: Request }) => {
      expect(await request.json()).toEqual({ email: "hire@example.com", role: "admin" });
      const invite = {
        ...pending,
        id: "inv_new",
        email: "hire@example.com",
        role: "admin" as const,
      };
      store.invites.push(invite);
      return HttpResponse.json({ invite, url: INVITE_URL }, { status: 201 });
    });
    server.use(http.post("/api/v1/invites", create));
    const { user, queryClient } = await renderApp("/users");
    await screen.findByText("Ada Admin");
    await user.click(screen.getByRole("button", { name: "Invite user" }));
    const sheet = await screen.findByRole("dialog");
    await user.type(within(sheet).getByLabelText("Email"), "hire@example.com");
    await user.click(within(sheet).getByRole("combobox", { name: "Role" }));
    await user.click(await screen.findByRole("option", { name: /^Admin/ }));
    await user.click(within(sheet).getByRole("button", { name: "Send invite" }));
    const dialog = await screen.findByRole("dialog", { name: "Copy the invite link" });
    expect(within(dialog).getByText(INVITE_URL)).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "Share this link with hire@example.com. It works once and expires in 72 hours.",
    );
    expectUndismissable("Copy the invite link");
    await user.click(within(dialog).getByRole("button", { name: "I've copied it" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("hire@example.com")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("anc_inv_ONE-TIME");
    const caches = JSON.stringify([
      queryClient
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data),
      queryClient
        .getMutationCache()
        .getAll()
        .map((m) => m.state),
    ]);
    expect(caches).not.toContain("anc_inv_ONE-TIME");
  });

  it("reset link dialog shows URL once", async () => {
    setup();
    const reset = vi.fn(() =>
      HttpResponse.json({ url: RESET_URL, expiresAt: now + 3_600_000 }, { status: 201 }),
    );
    server.use(http.post("/api/v1/users/u_member/password-reset", reset));
    const { user } = await renderApp("/users");
    await openActions(user, "Max Member");
    await user.click(await screen.findByRole("menuitem", { name: "Create password reset link" }));
    const dialog = await screen.findByRole("dialog", { name: "Copy the password reset link" });
    expect(within(dialog).getByText(RESET_URL)).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "Send this link to Max Member. It works once and expires in 1 hour.",
    );
    expect(dialog).toHaveTextContent(/Max Member, expires /);
    expectUndismissable("Copy the password reset link");
    await user.click(within(dialog).getByRole("button", { name: "I've copied it" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body.textContent).not.toContain("anc_rst_ONE-TIME");
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("last owner conflict shows server message", async () => {
    setup();
    server.use(
      http.patch("/api/v1/users/u_oscar", () =>
        apiError(409, "conflict", "An instance must keep at least one active owner"),
      ),
    );
    const { user } = await renderApp("/users");
    await openActions(user, "Oscar Owner");
    await user.click(await screen.findByRole("menuitem", { name: "Change role" }));
    // jsdom has no geometry for Radix's submenu pointer grace area: select without moving.
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Admin" }));
    expect(
      await screen.findByText("An instance must keep at least one active owner"),
    ).toBeInTheDocument();
  });

  it("change role, disable and delete call the API", async () => {
    const store = setup();
    const patch = vi.fn(async ({ request }: { request: Request }) => {
      const body = (await request.json()) as { role?: string; disabled?: boolean };
      const i = store.users.findIndex((u) => u.id === "u_member");
      const u = store.users[i] as UserDto;
      store.users[i] = {
        ...u,
        ...(body.role ? { role: body.role as UserDto["role"] } : {}),
        ...(body.disabled !== undefined ? { disabledAt: body.disabled ? now : null } : {}),
      };
      return HttpResponse.json({ user: store.users[i] });
    });
    const remove = vi.fn(() => {
      store.users = store.users.filter((u) => u.id !== "u_member");
      return new HttpResponse(null, { status: 204 });
    });
    server.use(
      http.patch("/api/v1/users/u_member", patch),
      http.delete("/api/v1/users/u_member", remove),
    );
    const { user } = await renderApp("/users");
    await openActions(user, "Max Member");
    await user.click(await screen.findByRole("menuitem", { name: "Change role" }));
    // jsdom has no geometry for Radix's submenu pointer grace area: select without moving.
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Admin" }));
    await waitFor(() =>
      expect(
        within(screen.getByText("Max Member").closest("tr") as HTMLElement).getByText("Admin"),
      ).toBeInTheDocument(),
    );
    await openActions(user, "Max Member");
    await user.click(await screen.findByRole("menuitem", { name: "Disable" }));
    await waitFor(() =>
      expect(
        within(screen.getByText("Max Member").closest("tr") as HTMLElement).getByText("Disabled"),
      ).toBeInTheDocument(),
    );
    await openActions(user, "Max Member");
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete user Max Member" });
    await user.click(within(dialog).getByRole("button", { name: "Delete user" }));
    await waitFor(() => expect(screen.queryByText("Max Member")).toBeNull());
    expect(patch.mock.calls.length).toBe(2);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("own row hides role/disable/delete actions", async () => {
    setup();
    await renderApp("/users");
    const own = await rowOf("Olivia Owner");
    expect(within(own).queryByRole("button", { name: /^Actions for/ })).toBeNull();
  });

  it("an admin cannot manage owners and cannot grant the owner role", async () => {
    signedInAs(ada);
    server.use(
      http.get("/api/v1/users", () => HttpResponse.json({ users: [me, ada, max] })),
      http.get("/api/v1/invites", () => HttpResponse.json({ invites: [] })),
    );
    const { user } = await renderApp("/users");
    expect(
      within(await rowOf("Olivia Owner")).queryByRole("button", { name: /^Actions for/ }),
    ).toBeNull();
    await openActions(user, "Max Member");
    await user.click(await screen.findByRole("menuitem", { name: "Change role" }));
    expect(await screen.findByRole("menuitemradio", { name: "Admin" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitemradio", { name: "Owner" })).toBeNull();
  });

  it("revoke invite only for pending", async () => {
    const store = setup();
    const revoke = vi.fn(() => {
      store.invites = store.invites.map((i) =>
        i.id === "inv_pending" ? { ...i, revokedAt: Date.now() } : i,
      );
      return new HttpResponse(null, { status: 204 });
    });
    server.use(http.delete("/api/v1/invites/inv_pending", revoke));
    const { user } = await renderApp("/users");
    expect(
      within(await rowOf("joined@example.com")).queryByRole("button", { name: /^Actions for/ }),
    ).toBeNull();
    await openActions(user, "new@example.com");
    await user.click(await screen.findByRole("menuitem", { name: "Revoke" }));
    const dialog = await screen.findByRole("dialog", { name: "Revoke invite for new@example.com" });
    await user.click(within(dialog).getByRole("button", { name: "Revoke invite" }));
    await waitFor(() =>
      expect(
        within(screen.getByText("new@example.com").closest("tr") as HTMLElement).getByText(
          "Revoked",
        ),
      ).toBeInTheDocument(),
    );
    expect(revoke).toHaveBeenCalledTimes(1);
  });
});

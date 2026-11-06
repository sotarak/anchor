import type { MemberDto } from "@anchor/shared";
import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { apiError, fixtures, projectExists, renderApp, server, signedInAs } from "#test/support";

const URL_ = "/api/v1/projects/app/members";
const PAGE = "/projects/app/settings/members";
const members: MemberDto[] = [
  {
    userId: "u_owner",
    email: "owner@example.com",
    name: "Olivia Owner",
    role: "admin",
    environments: null,
  },
  {
    userId: "u_member",
    email: "member@example.com",
    name: "Max Member",
    role: "developer",
    environments: ["dev", "staging"],
  },
  {
    userId: "u_view",
    email: "vera@example.com",
    name: "Vera Viewer",
    role: "viewer",
    environments: ["prod"],
  },
];

function setup(list: MemberDto[] = members) {
  signedInAs(fixtures.owner);
  projectExists();
  const store = { members: [...list] };
  server.use(http.get(URL_, () => HttpResponse.json({ members: store.members })));
  return store;
}

async function rowOf(name: string) {
  return (await screen.findByText(name)).closest("tr") as HTMLElement;
}

async function openAdd(user: Awaited<ReturnType<typeof renderApp>>["user"]) {
  await screen.findByText("Olivia Owner");
  await user.click(screen.getByRole("button", { name: "Add member" }));
  return screen.findByRole("dialog");
}

describe("/projects/$project/settings/members", () => {
  it("list renders roles and env tags; All environments when null", async () => {
    setup();
    await renderApp(PAGE);
    const owner = await rowOf("Olivia Owner");
    expect(within(owner).getByText("owner@example.com")).toBeInTheDocument();
    expect(within(owner).getByText("OO")).toBeInTheDocument();
    expect(within(owner).getByText("Admin")).toBeInTheDocument();
    expect(within(owner).getByText("All environments")).toBeInTheDocument();
    const max = await rowOf("Max Member");
    expect(within(max).getByText("Developer")).toBeInTheDocument();
    expect(within(max).getByText("dev")).toBeInTheDocument();
    expect(within(max).getByText("staging")).toBeInTheDocument();
    expect(
      within(screen.getByRole("banner")).getByRole("heading", { name: "Members" }),
    ).toBeInTheDocument();
  });

  it("add with restricted envs sends environment slugs", async () => {
    setup();
    const add = vi.fn(async ({ request }: { request: Request }) => {
      expect(await request.json()).toEqual({
        email: "new@example.com",
        role: "viewer",
        environments: ["prod"],
      });
      return HttpResponse.json(
        {
          member: {
            userId: "u_new",
            email: "new@example.com",
            name: "New",
            role: "viewer",
            environments: ["prod"],
          },
        },
        { status: 201 },
      );
    });
    server.use(http.post(URL_, add));
    const { user } = await renderApp(PAGE);
    const sheet = await openAdd(user);
    await user.type(within(sheet).getByLabelText("Email"), "new@example.com");
    await user.click(within(sheet).getByRole("combobox", { name: "Role" }));
    await user.click(await screen.findByRole("option", { name: /^Viewer/ }));
    await user.click(within(sheet).getByRole("checkbox", { name: "All environments" }));
    await user.click(within(sheet).getByRole("checkbox", { name: /^Production/ }));
    await user.click(within(sheet).getByRole("button", { name: "Add member" }));
    expect(await screen.findByText("Member added")).toBeInTheDocument();
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("admin role fixes environments to All and sends null", async () => {
    setup();
    const add = vi.fn(async ({ request }: { request: Request }) => {
      expect(await request.json()).toEqual({
        email: "new@example.com",
        role: "admin",
        environments: null,
      });
      return HttpResponse.json({ member: members[0] }, { status: 201 });
    });
    server.use(http.post(URL_, add));
    const { user } = await renderApp(PAGE);
    const sheet = await openAdd(user);
    await user.type(within(sheet).getByLabelText("Email"), "new@example.com");
    await user.click(within(sheet).getByRole("checkbox", { name: "All environments" }));
    await user.click(within(sheet).getByRole("combobox", { name: "Role" }));
    await user.click(await screen.findByRole("option", { name: /^Admin/ }));
    const all = within(sheet).getByRole("checkbox", { name: "All environments" });
    expect(all).toBeChecked();
    expect(all).toBeDisabled();
    expect(within(sheet).queryByRole("checkbox", { name: /^Production/ })).toBeNull();
    await user.click(within(sheet).getByRole("button", { name: "Add member" }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
  });

  it("unchecking All environments with no env selected blocks submit", async () => {
    setup();
    const add = vi.fn(() => HttpResponse.json({}));
    server.use(http.post(URL_, add));
    const { user } = await renderApp(PAGE);
    const sheet = await openAdd(user);
    await user.type(within(sheet).getByLabelText("Email"), "new@example.com");
    await user.click(within(sheet).getByRole("checkbox", { name: "All environments" }));
    await user.click(within(sheet).getByRole("button", { name: "Add member" }));
    expect(await within(sheet).findByText("Pick at least one environment")).toBeInTheDocument();
    expect(add).not.toHaveBeenCalled();
  });

  it("unknown email shows the invite hint", async () => {
    setup();
    server.use(http.post(URL_, () => apiError(404, "not_found", "User not found")));
    const { user } = await renderApp(PAGE);
    const sheet = await openAdd(user);
    await user.type(within(sheet).getByLabelText("Email"), "ghost@example.com");
    await user.click(within(sheet).getByRole("button", { name: "Add member" }));
    expect(
      await within(sheet).findByText("No user with this email. Invite them from Users first."),
    ).toBeInTheDocument();
  });

  it("edit role and remove member call the API", async () => {
    const store = setup();
    const update = vi.fn(async ({ request }: { request: Request }) => {
      expect(await request.json()).toEqual({ role: "admin", environments: null });
      const m: MemberDto = { ...(members[1] as MemberDto), role: "admin", environments: null };
      store.members[1] = m;
      return HttpResponse.json({ member: m });
    });
    const remove = vi.fn(() => {
      store.members = store.members.filter((m) => m.userId !== "u_view");
      return new HttpResponse(null, { status: 204 });
    });
    server.use(http.patch(`${URL_}/u_member`, update), http.delete(`${URL_}/u_view`, remove));
    const { user } = await renderApp(PAGE);

    await user.click(
      within(await rowOf("Max Member")).getByRole("button", { name: "Actions for Max Member" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).queryByLabelText("Email")).toBeNull();
    expect(within(sheet).getByRole("checkbox", { name: /^Development/ })).toBeChecked();
    await user.click(within(sheet).getByRole("combobox", { name: "Role" }));
    await user.click(await screen.findByRole("option", { name: /^Admin/ }));
    await user.click(within(sheet).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        within(screen.getByText("Max Member").closest("tr") as HTMLElement).getByText(
          "All environments",
        ),
      ).toBeInTheDocument(),
    );

    await user.click(
      within(await rowOf("Vera Viewer")).getByRole("button", { name: "Actions for Vera Viewer" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Remove" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove Vera Viewer from App" });
    await user.click(within(dialog).getByRole("button", { name: "Remove member" }));
    await waitFor(() => expect(screen.queryByText("Vera Viewer")).toBeNull());
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("403 renders ForbiddenState", async () => {
    signedInAs(fixtures.member);
    projectExists({ ...fixtures.project, access: { role: "developer", environments: null } });
    server.use(http.get(URL_, () => apiError(403, "forbidden", "Forbidden")));
    await renderApp(PAGE);
    expect(
      await screen.findByText("You don't have access to this project's members"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add member" })).toBeNull();
  });

  it("filtered-empty for role filter", async () => {
    setup(members.slice(0, 2));
    const { user } = await renderApp(PAGE);
    await screen.findByText("Olivia Owner");
    await user.click(screen.getByRole("button", { name: "Role" }));
    await user.click(await screen.findByRole("checkbox", { name: "Viewer" }));
    await user.keyboard("{Escape}");
    expect(await screen.findByText("No results match your filters")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByText("Olivia Owner")).toBeInTheDocument();
  });

  it("search filters by name or email", async () => {
    setup();
    const { user } = await renderApp(PAGE);
    await screen.findByText("Olivia Owner");
    await user.click(screen.getByRole("button", { name: "Search members" }));
    await user.type(screen.getByRole("searchbox", { name: "Search members" }), "vera@");
    expect(screen.getByText("Vera Viewer")).toBeInTheDocument();
    expect(screen.queryByText("Olivia Owner")).toBeNull();
  });
});

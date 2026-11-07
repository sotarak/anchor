import type { ProjectDto, SecretDto, SecretVersionDto } from "@anchor/shared";
import { screen, waitFor, within } from "@testing-library/react";
import { delay, HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { fixtures, foldersAre, projectExists, renderApp, server, signedInAs } from "#test/support";

const base = "/api/v1/projects/app/environments/dev/secrets";
const CANARY = "HISTORY-WEB-CANARY-v1";
const MASK = "••••••••";
const T = Date.UTC(2026, 3, 2, 12, 0, 0);
const key = fixtures.secrets[0] as SecretDto; // API_KEY v2
const versions: SecretVersionDto[] = [
  {
    version: 2,
    comment: "Stripe key",
    createdAt: T + 86_400_000,
    createdBy: { id: "u", label: "owner@example.com" },
  },
  { version: 1, comment: "first", createdAt: T, createdBy: null },
];

function setup(opts: { project?: ProjectDto; versions?: SecretVersionDto[] | "slow" } = {}) {
  signedInAs(fixtures.owner);
  projectExists(opts.project ?? fixtures.project);
  foldersAre("dev");
  const valueCalls = vi.fn();
  const rollbacks: unknown[] = [];
  server.use(
    http.get(base, () => HttpResponse.json({ secrets: fixtures.secrets })),
    http.get(`${base}/API_KEY/versions`, async () => {
      if (opts.versions === "slow") await delay("infinite");
      return HttpResponse.json({ versions: opts.versions ?? versions });
    }),
    http.get(`${base}/API_KEY/versions/:version`, ({ params }) => {
      valueCalls(params.version);
      return HttpResponse.json({ version: { ...versions[1], value: CANARY } });
    }),
    http.post(`${base}/API_KEY/rollback`, async ({ request }) => {
      rollbacks.push(await request.json());
      return HttpResponse.json({ secret: { ...key, version: 3, comment: "first" }, changed: true });
    }),
  );
  return { valueCalls, rollbacks };
}

async function openHistory() {
  const r = await renderApp("/projects/app/environments/dev");
  const row = (await screen.findByText("API_KEY")).closest("tr") as HTMLElement;
  await r.user.click(within(row).getByRole("button", { name: "Actions for API_KEY" }));
  await r.user.click(await screen.findByRole("menuitem", { name: "History" }));
  const dialog = await screen.findByRole("dialog", { name: "History" });
  expect(dialog).toHaveAccessibleDescription("Every saved version of API_KEY at /, newest first.");
  const sheet = within(dialog);
  return { ...r, sheet };
}

const versionRows = (sheet: ReturnType<typeof within>) =>
  sheet.getAllByRole("row").slice(1) as HTMLElement[];

describe("secret history sheet", () => {
  it("lists versions newest first with current badge", async () => {
    setup();
    const { sheet } = await openHistory();
    await sheet.findByText("v2");
    const [newest, oldest] = versionRows(sheet);
    expect(within(newest as HTMLElement).getByText("v2")).toBeInTheDocument();
    expect(within(newest as HTMLElement).getByText("Current")).toBeInTheDocument();
    expect(within(newest as HTMLElement).getByText("owner@example.com")).toBeInTheDocument();
    expect(within(oldest as HTMLElement).getByText("v1")).toBeInTheDocument();
    expect(within(oldest as HTMLElement).getByText("first")).toBeInTheDocument();
    expect(within(oldest as HTMLElement).queryByText("Current")).toBeNull();
    expect(within(oldest as HTMLElement).getByText("Apr 2, 2026")).toBeInTheDocument();
  });

  it("dates stay on one line and long author emails truncate in the narrow sheet", async () => {
    setup();
    const { sheet } = await openHistory();
    await sheet.findByText("v2");
    const [newest] = versionRows(sheet);
    const cells = within(newest as HTMLElement).getAllByRole("cell");
    expect(cells[3]?.className).toMatch(/\bwhitespace-nowrap\b/);
    const author = within(newest as HTMLElement).getByText("owner@example.com");
    expect(author.className).toMatch(/\btruncate\b/);
    expect(author.className).toMatch(/\bmax-w-/);
  });

  it("opens in the wide sheet so all five columns fit without sideways scroll", async () => {
    setup();
    await openHistory();
    const dialog = screen.getByRole("dialog", { name: "History" });
    expect(dialog).toHaveAttribute("data-size", "wide");
    expect(dialog.className).toMatch(/\bsm:max-w-2xl\b/);
    expect(dialog.className).not.toMatch(/\bsm:max-w-xl\b/);
  });

  it("value not requested until reveal clicked", async () => {
    const { valueCalls } = setup();
    const { sheet, user, queryClient } = await openHistory();
    await sheet.findByText("v1");
    const oldest = versionRows(sheet)[1] as HTMLElement;
    expect(within(oldest).getByText(MASK)).toBeInTheDocument();
    expect(valueCalls).not.toHaveBeenCalled();

    await user.click(within(oldest).getByRole("button", { name: "Reveal value" }));
    expect(await within(oldest).findByText(CANARY)).toBeInTheDocument();
    expect(valueCalls).toHaveBeenCalledWith("1");
    expect(
      JSON.stringify(
        queryClient
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
      ),
    ).not.toContain(CANARY);
    await user.click(within(oldest).getByRole("button", { name: "Hide value" }));
    expect(within(oldest).getByText(MASK)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(CANARY);
  });

  it("rollback confirm posts version and shows toast", async () => {
    const { rollbacks } = setup();
    const { sheet, user } = await openHistory();
    await sheet.findByText("v1");
    const [newest, oldest] = versionRows(sheet);
    expect(
      within(newest as HTMLElement).queryByRole("button", { name: "Roll back to v2" }),
    ).toBeNull();
    await user.click(
      within(oldest as HTMLElement).getByRole("button", { name: "Roll back to v1" }),
    );
    const confirm = within(await screen.findByRole("dialog", { name: "Roll back API_KEY to v1" }));
    await user.click(confirm.getByRole("button", { name: "Roll back" }));
    expect(await screen.findByText("Rolled back to v1")).toBeInTheDocument();
    expect(rollbacks).toEqual([{ path: "/", version: 1 }]);
  });

  it("viewer does not see rollback action", async () => {
    setup({ project: { ...fixtures.project, access: { role: "viewer", environments: null } } });
    const { sheet } = await openHistory();
    await sheet.findByText("v1");
    expect(sheet.queryByRole("button", { name: /Roll back/ })).toBeNull();
  });

  it("loading and empty states", async () => {
    setup({ versions: "slow" });
    const { sheet } = await openHistory();
    expect(sheet.getAllByTestId("skeleton-row").length).toBeGreaterThan(0);
  });

  it("empty history says so", async () => {
    setup({ versions: [] });
    const { sheet } = await openHistory();
    expect(await sheet.findByText("No versions yet")).toBeInTheDocument();
    await waitFor(() => expect(sheet.queryAllByTestId("skeleton-row")).toHaveLength(0));
  });
});

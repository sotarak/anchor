import type { KeyRotationDto, ProjectKeyDto } from "@anchor/shared";
import { act, screen, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, fixtures, projectExists, renderApp, server, signedInAs } from "#test/support";

const PAGE = "/projects/app/settings/encryption";
const keysUrl = "/api/v1/projects/app/keys";
const T = Date.UTC(2026, 3, 2, 12, 0, 0);

const key = (version: number, status: ProjectKeyDto["status"]): ProjectKeyDto => ({
  version,
  status,
  rootKeyId: "rk1",
  createdAt: T,
});
const rotation = (over: Partial<KeyRotationDto> = {}): KeyRotationDto => ({
  id: "r1",
  fromVersion: 1,
  toVersion: 2,
  status: "running",
  total: 150,
  done: 50,
  error: null,
  startedAt: T,
  finishedAt: null,
  ...over,
});

type Status = { keys: ProjectKeyDto[]; rotations: KeyRotationDto[] };

/** GET /keys answers from `sequence` (the last answer repeats); records each GET. */
function keysAre(...sequence: Status[]) {
  let gets = 0;
  server.use(
    http.get(keysUrl, () => {
      const answer = sequence[Math.min(gets, sequence.length - 1)];
      gets++;
      return HttpResponse.json(answer);
    }),
  );
  return { gets: () => gets };
}

function setup() {
  signedInAs(fixtures.owner);
  projectExists();
}

afterEach(() => {
  vi.useRealTimers();
});

const rowWith = (text: string) => screen.getByText(text).closest("tr") as HTMLElement;

describe("encryption settings", () => {
  it("shows key versions with mapped badges", async () => {
    setup();
    keysAre({
      keys: [key(3, "active"), key(2, "retiring"), key(1, "retired")],
      rotations: [
        rotation({
          id: "r2",
          fromVersion: 2,
          toVersion: 3,
          status: "failed",
          error: "decrypt_failed",
          done: 3,
        }),
        rotation({ status: "completed", done: 150, finishedAt: T + 1000 }),
      ],
    });
    await renderApp(PAGE);
    expect(await screen.findByRole("heading", { name: "Encryption" })).toBeInTheDocument();
    const badge = (row: HTMLElement, text: string) =>
      within(row).getByText(text).closest("[data-slot=status-badge]");
    expect(badge(rowWith("v3"), "Active")?.className).toContain("success");
    expect(badge(rowWith("v2"), "Retiring")?.className).toContain("warning");
    expect(badge(rowWith("v1"), "Retired")?.className).toContain("faded");
    expect(within(rowWith("v3")).getByText("rk1")).toBeInTheDocument();
    expect(badge(rowWith("v2 → v3"), "Failed: decrypt_failed")?.className).toContain("error");
    expect(badge(rowWith("v1 → v2"), "Completed")?.className).toContain("success");
  });

  it("polls while running and stops when completed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup();
    const { gets } = keysAre(
      { keys: [key(2, "active"), key(1, "retiring")], rotations: [rotation()] },
      { keys: [key(2, "active"), key(1, "retiring")], rotations: [rotation({ done: 100 })] },
      {
        keys: [key(2, "active"), key(1, "retired")],
        rotations: [rotation({ status: "completed", done: 150, finishedAt: T })],
      },
    );
    await renderApp(PAGE);
    expect(await screen.findByText("Running 50 of 150")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(await screen.findByText("Running 100 of 150")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(await screen.findByText("Completed")).toBeInTheDocument();
    const afterDone = gets();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(gets()).toBe(afterDone);
  });

  it("rotate confirm posts and shows running progress", async () => {
    setup();
    const posts: unknown[] = [];
    keysAre(
      { keys: [key(1, "active")], rotations: [] },
      { keys: [key(2, "active"), key(1, "retiring")], rotations: [rotation({ done: 0 })] },
    );
    server.use(
      http.post(`${keysUrl}/rotate`, () => {
        posts.push(true);
        return HttpResponse.json({ rotation: rotation({ done: 0 }) }, { status: 202 });
      }),
    );
    const { user } = await renderApp(PAGE);
    expect(await screen.findByText("No rotations yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Rotate key" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Rotate the project key" }));
    expect(dialog.getByText(/re-encrypted in the background/)).toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Rotate key" }));
    expect(await screen.findByText("Key rotation started")).toBeInTheDocument();
    expect(await screen.findByText("Running 0 of 150")).toBeInTheDocument();
    expect(posts).toHaveLength(1);
  });

  it("running rotation shows Resume rotation", async () => {
    setup();
    keysAre({ keys: [key(2, "active"), key(1, "retiring")], rotations: [rotation()] });
    await renderApp(PAGE);
    expect(await screen.findByRole("button", { name: "Resume rotation" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rotate key" })).toBeNull();
  });

  it("non-admin does not see rotate", async () => {
    signedInAs(fixtures.member);
    projectExists({ ...fixtures.project, access: { role: "developer", environments: null } });
    server.use(
      http.get(keysUrl, () =>
        apiError(403, "forbidden", "You do not have permission to perform this action"),
      ),
    );
    await renderApp(PAGE);
    expect(await screen.findByText(/You don.t have access to/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Rotate key|Resume rotation/ })).toBeNull();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).queryByRole("link", { name: "Encryption" })).toBeNull();
  });
});

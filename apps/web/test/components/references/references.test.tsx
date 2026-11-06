import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
import { ReferenceText } from "@/components/references/reference-text";

const base = "/api/v1/projects/app/environments/dev/secrets";
const RAW = "postgres://${DB_USER}@${prod:/db/HOST}/x";
const RESOLVED = "postgres://RESOLVED-CANARY@db.internal/x";

const chip = (text: string) => screen.getByText(text).closest("[data-slot=tag]");

describe("ReferenceText", () => {
  it("highlights ${KEY} and ${prod:/db/P} as chips; $${X} stays text", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ReferenceText value="a ${KEY} b ${prod:/db/P} $${X} c" env="dev" path="/api" />,
    );
    expect(container.textContent).toBe("a ${KEY} b ${prod:/db/P} ${X} c");
    expect(chip("${KEY}")).not.toBeNull();
    expect(chip("${prod:/db/P}")).not.toBeNull();
    expect(screen.getByText(/\$\{X\}/).closest("[data-slot=tag]")).toBeNull();

    await user.hover(screen.getByText("${KEY}"));
    expect((await screen.findByRole("tooltip")).textContent).toBe("dev:/api/KEY");
    await user.unhover(screen.getByText("${KEY}"));
    await user.hover(screen.getByText("${prod:/db/P}"));
    await waitFor(() =>
      expect(screen.getAllByRole("tooltip").map((t) => t.textContent)).toContain("prod:/db/P"),
    );
  });
});

/** Single GET answers by `expand`: raw value, or `resolved()` for expand=true. */
function setup(resolved: () => Response) {
  signedInAs(fixtures.owner);
  projectExists();
  foldersAre("dev");
  const urls: URL[] = [];
  server.use(
    http.get(base, () => HttpResponse.json({ secrets: fixtures.secrets })),
    http.get(`${base}/:key`, ({ request }) => {
      const url = new URL(request.url);
      urls.push(url);
      if (url.searchParams.get("expand") === "true") return resolved();
      return HttpResponse.json({ secret: { ...fixtures.secrets[0], value: RAW } });
    }),
  );
  return { urls };
}

const ok = () =>
  HttpResponse.json({ secret: { ...fixtures.secrets[0], value: RESOLVED, rawValue: RAW } });

async function openEdit() {
  const r = await renderApp("/projects/app/environments/dev");
  const row = (await screen.findByText("API_KEY")).closest("tr") as HTMLElement;
  await r.user.click(within(row).getByRole("button", { name: "Actions for API_KEY" }));
  await r.user.click(await screen.findByRole("menuitem", { name: "Edit" }));
  return { ...r, sheet: within(await screen.findByRole("dialog", { name: "Edit API_KEY" })) };
}

describe("resolved preview in the editor", () => {
  it("resolved preview masked until requested", async () => {
    const { urls } = setup(ok);
    const { sheet, user } = await openEdit();
    expect(sheet.getByText("Resolved value")).toBeInTheDocument();
    expect(sheet.getByText("••••••••")).toBeInTheDocument();
    expect(urls).toEqual([]);
    await user.click(sheet.getByRole("button", { name: "Show resolved value" }));
    expect(await sheet.findByText(RESOLVED)).toBeInTheDocument();
    expect(urls.map((u) => u.searchParams.get("expand"))).toEqual(["true"]);
    await user.click(sheet.getByRole("button", { name: "Hide resolved value" }));
    expect(document.body.textContent).not.toContain(RESOLVED);
  });

  it("400 unresolved shows server message with $${ hint", async () => {
    const message = "Unresolved reference ${NOPE} in dev:/API_KEY; escape a literal with $${";
    setup(() => apiError(400, "bad_request", message));
    const { sheet, user } = await openEdit();
    await user.click(sheet.getByRole("button", { name: "Show resolved value" }));
    const hint = await sheet.findByText(message);
    expect(hint).toHaveClass("text-error-base");
  });

  it("403 shows forbidden message and no value", async () => {
    const message =
      "You do not have permission to read the reference ${prod:/db/HOST} in dev:/API_KEY";
    setup(() => apiError(403, "forbidden", message));
    const { sheet, user } = await openEdit();
    await user.click(sheet.getByRole("button", { name: "Show resolved value" }));
    expect(await sheet.findByText(message)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("RESOLVED-CANARY");
    expect(sheet.queryByRole("button", { name: "Hide resolved value" })).toBeNull();
  });
});

describe("revealed values in the table", () => {
  it("render raw with reference chips until Show resolved is chosen", async () => {
    const { urls } = setup(ok);
    const { user } = await renderApp("/projects/app/environments/dev");
    const row = (await screen.findByText("API_KEY")).closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Reveal value" }));
    expect((await within(row).findByText("${DB_USER}")).closest("[data-slot=tag]")).not.toBeNull();
    expect(urls.map((u) => u.searchParams.get("expand"))).toEqual([null]);
    await user.click(within(row).getByRole("button", { name: "Show resolved value" }));
    expect(await within(row).findByText(RESOLVED)).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Hide value" }));
    expect(document.body.textContent).not.toContain(RESOLVED);
    await user.click(within(row).getByRole("button", { name: "Reveal value" }));
    expect(await within(row).findByText("${DB_USER}")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(RESOLVED);
  });
});

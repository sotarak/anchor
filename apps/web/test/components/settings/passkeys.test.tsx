import type { MfaStatusDto, PasskeyDto } from "@anchor/shared";
import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtures, MFA_OFF, mfaStatusIs, renderApp, server, signedInAs } from "#test/support";
import { formatDate } from "@/lib/format";
import { createPasskey, passkeysSupported } from "@/lib/webauthn";

vi.mock("@/lib/webauthn", () => ({
  passkeysSupported: vi.fn(() => true),
  getPasskeyAssertion: vi.fn(),
  createPasskey: vi.fn(),
  isPasskeyCancel: (e: unknown) => e instanceof Error && e.name === "NotAllowedError",
}));

const T = Date.UTC(2026, 10, 2, 12, 0, 0);
const laptop: PasskeyDto = {
  id: "cred-laptop",
  name: "Laptop",
  rpId: "localhost",
  usableHere: true,
  backedUp: true,
  createdAt: T,
  lastUsedAt: null,
};
const phone: PasskeyDto = {
  ...laptop,
  id: "cred-phone",
  name: "Phone",
  rpId: "old.example.com",
  usableHere: false,
  lastUsedAt: T + 86_400_000,
};
const withPasskeys = (passkeys: PasskeyDto[]): MfaStatusDto => ({
  ...MFA_OFF,
  enabled: passkeys.length > 0,
  passkeys,
  recoveryCodesRemaining: passkeys.length > 0 ? 10 : 0,
});
const CODES = Array.from({ length: 10 }, (_, i) => `cccc${i}-dddd${i}`);
const ATTESTATION = { id: "cred-new", rawId: "cred-new", type: "public-key", response: {} };

beforeEach(() => {
  vi.mocked(passkeysSupported).mockReturnValue(true);
  vi.mocked(createPasskey).mockReset();
  signedInAs(fixtures.owner);
  server.use(
    http.get("/api/v1/auth/sessions", () => HttpResponse.json({ sessions: [] })),
    http.get("/api/v1/oauth/grants", () => HttpResponse.json({ grants: [] })),
  );
});

const passkeys = () => screen.getByRole("region", { name: "Passkeys" });

async function openAccount() {
  const app = await renderApp("/account");
  await screen.findByRole("region", { name: "Passkeys" });
  return app;
}

async function addNamed(user: Awaited<ReturnType<typeof openAccount>>["user"], name: string) {
  await user.click(within(passkeys()).getByRole("button", { name: "Add a passkey" }));
  const dialog = await screen.findByRole("dialog", { name: "Add a passkey" });
  await user.type(within(dialog).getByLabelText("Passkey name"), name);
  await user.click(within(dialog).getByRole("button", { name: "Continue" }));
  return dialog;
}

describe("Account: passkeys", () => {
  it("lists name, created and last-used dates", async () => {
    mfaStatusIs(withPasskeys([laptop, phone]));
    await openAccount();
    const laptopRow = within(passkeys()).getByText("Laptop").closest("tr") as HTMLElement;
    expect(within(laptopRow).getByText(formatDate(T))).toBeInTheDocument();
    expect(within(laptopRow).getByText("–")).toBeInTheDocument();
    expect(within(laptopRow).queryByText(/Registered on/)).toBeNull();
    const phoneRow = within(passkeys()).getByText("Phone").closest("tr") as HTMLElement;
    expect(within(phoneRow).queryByText("–")).toBeNull();
  });

  it("a passkey from another address says where it works", async () => {
    mfaStatusIs(withPasskeys([phone]));
    await openAccount();
    expect(within(passkeys()).getByText("Registered on old.example.com")).toBeInTheDocument();
  });

  it("shows an empty line when there are none", async () => {
    mfaStatusIs(MFA_OFF);
    await openAccount();
    expect(within(passkeys()).getByText("No passkeys yet.")).toBeInTheDocument();
  });

  it("adds a passkey: name, browser prompt, POST, then the recovery codes for a first factor", async () => {
    let list: PasskeyDto[] = [];
    mfaStatusIs(() => withPasskeys(list));
    server.use(
      http.post("/api/v1/auth/mfa/passkeys/options", () =>
        HttpResponse.json({ options: { challenge: "reg" } }),
      ),
    );
    const sent = vi.fn();
    server.use(
      http.post("/api/v1/auth/mfa/passkeys", async ({ request }) => {
        sent(await request.json());
        const passkey = { ...laptop, id: "cred-new", name: "Work laptop" };
        list = [passkey];
        return HttpResponse.json({ passkey, recoveryCodes: CODES }, { status: 201 });
      }),
    );
    vi.mocked(createPasskey).mockResolvedValue(ATTESTATION);
    const { user } = await openAccount();
    await addNamed(user, "Work laptop");

    const codes = await screen.findByRole("dialog", { name: "Save your recovery codes" });
    expect(within(codes).getByText(CODES[0] as string)).toBeInTheDocument();
    expect(createPasskey).toHaveBeenCalledWith({ challenge: "reg" });
    expect(sent).toHaveBeenCalledWith({ name: "Work laptop", response: ATTESTATION });
    expect(screen.queryByRole("dialog", { name: "Add a passkey" })).toBeNull();
    await user.click(within(codes).getByRole("button", { name: "Done" }));
    expect(await within(passkeys()).findByText("Work laptop")).toBeInTheDocument();
  });

  it("a cancelled browser prompt shows no error and posts nothing", async () => {
    mfaStatusIs(MFA_OFF);
    server.use(
      http.post("/api/v1/auth/mfa/passkeys/options", () =>
        HttpResponse.json({ options: { challenge: "reg" } }),
      ),
    );
    const add = vi.fn(() => HttpResponse.json({}));
    server.use(http.post("/api/v1/auth/mfa/passkeys", add));
    vi.mocked(createPasskey).mockRejectedValue(
      Object.assign(new Error("cancelled"), { name: "NotAllowedError" }),
    );
    const { user } = await openAccount();
    const dialog = await addNamed(user, "Laptop");
    await waitFor(() => expect(createPasskey).toHaveBeenCalled());
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Continue" })).toBeEnabled(),
    );
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(add).not.toHaveBeenCalled();
    expect(screen.queryByText("cancelled")).toBeNull();
  });

  it("removing asks for confirmation, then refreshes the list", async () => {
    let list = [laptop, phone];
    const status = mfaStatusIs(() => withPasskeys(list));
    const remove = vi.fn(({ params }: { params: Record<string, string | readonly string[]> }) => {
      list = list.filter((p) => p.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    });
    server.use(http.delete("/api/v1/auth/mfa/passkeys/:id", remove));
    const { user } = await openAccount();
    await user.click(within(passkeys()).getByRole("button", { name: "Actions for Laptop" }));
    await user.click(await screen.findByRole("menuitem", { name: "Remove" }));
    const dialog = await screen.findByRole("dialog", { name: 'Remove passkey "Laptop"?' });
    expect(remove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Remove passkey" }));
    await waitFor(() => expect(within(passkeys()).queryByText("Laptop")).toBeNull());
    expect(remove).toHaveBeenCalledTimes(1);
    expect(status.mock.calls.length).toBeGreaterThan(1);
  });

  it("without browser support the add button gives way to a notice", async () => {
    vi.mocked(passkeysSupported).mockReturnValue(false);
    mfaStatusIs(withPasskeys([laptop]));
    await openAccount();
    expect(within(passkeys()).queryByRole("button", { name: "Add a passkey" })).toBeNull();
    expect(
      within(passkeys()).getByText("This browser does not support passkeys."),
    ).toBeInTheDocument();
    expect(within(passkeys()).getByText("Laptop")).toBeInTheDocument();
  });
});

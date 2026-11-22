import type { MfaStatusDto } from "@anchor/shared";
import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiError,
  fixtures,
  MFA_OFF,
  mfaStatusIs,
  renderApp,
  server,
  signedInAs,
} from "#test/support";

vi.mock("@/lib/webauthn", () => ({
  passkeysSupported: vi.fn(() => true),
  getPasskeyAssertion: vi.fn(),
  createPasskey: vi.fn(),
  isPasskeyCancel: (e: unknown) => e instanceof Error && e.name === "NotAllowedError",
}));

const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const SETUP = {
  secret: SECRET,
  otpauthUri: `otpauth://totp/Anchor:owner%40example.com?secret=${SECRET}&issuer=Anchor`,
};
const CODES = Array.from({ length: 10 }, (_, i) => `aaaa${i}-bbbb${i}`);
const TOTP_ON: MfaStatusDto = { ...MFA_OFF, enabled: true, totp: true, recoveryCodesRemaining: 8 };
const PASSWORD = "correct horse battery";

beforeEach(() => {
  signedInAs(fixtures.owner);
  server.use(
    http.get("/api/v1/auth/sessions", () => HttpResponse.json({ sessions: [] })),
    http.get("/api/v1/oauth/grants", () => HttpResponse.json({ grants: [] })),
  );
});

const section = () => screen.getByRole("region", { name: "Two-factor authentication" });

async function openAccount() {
  const app = await renderApp("/account");
  await within(await screen.findByRole("region", { name: "Two-factor authentication" })).findByText(
    "Authenticator app",
  );
  return app;
}

/** POST handler answering from `answers` in order (the last repeats); records bodies. */
function post(path: string, ...answers: (() => Response)[]) {
  const bodies: unknown[] = [];
  server.use(
    http.post(`/api/v1${path}`, async ({ request }) => {
      const text = await request.text();
      bodies.push(text ? JSON.parse(text) : undefined);
      const answer = answers[Math.min(bodies.length - 1, answers.length - 1)];
      return answer ? answer() : new HttpResponse(null, { status: 204 });
    }),
  );
  return bodies;
}

const reauthRequired = () => apiError(403, "reauth_required", "Confirm it's you to continue");

describe("Account: two-factor authentication", () => {
  it("shows Off and a set-up action for a user without MFA", async () => {
    mfaStatusIs(MFA_OFF);
    await openAccount();
    expect(within(section()).getByText("Off")).toBeInTheDocument();
    expect(within(section()).getByRole("button", { name: "Set up" })).toBeInTheDocument();
    expect(within(section()).queryByText(/recovery codes left/)).toBeNull();
  });

  it("sets up the authenticator app: QR and key, code, then the recovery codes", async () => {
    let on = false;
    const status = mfaStatusIs(() => (on ? { ...TOTP_ON, recoveryCodesRemaining: 10 } : MFA_OFF));
    post("/auth/mfa/totp", () => HttpResponse.json(SETUP));
    const confirm = post("/auth/mfa/totp/confirm", () => {
      on = true;
      return HttpResponse.json({ recoveryCodes: CODES });
    });
    const { user } = await openAccount();
    await user.click(within(section()).getByRole("button", { name: "Set up" }));

    const dialog = await screen.findByRole("dialog", { name: "Set up an authenticator app" });
    expect(within(dialog).getByText("Scan the QR code, or enter this key:")).toBeInTheDocument();
    expect(within(dialog).getByRole("img", { name: "QR code" })).toBeInTheDocument();
    expect(within(dialog).getByText(SECRET)).toBeInTheDocument();
    const field = within(dialog).getByLabelText("Authentication code");
    expect(field).toHaveAttribute("autocomplete", "one-time-code");
    await user.type(field, "123456");
    await user.click(within(dialog).getByRole("button", { name: "Verify" }));

    const codes = await screen.findByRole("dialog", { name: "Save your recovery codes" });
    expect(
      within(codes).getByText(
        "Each code works once. Store them somewhere safe: they are the only way in if you lose your other factors.",
      ),
    ).toBeInTheDocument();
    for (const code of CODES) expect(within(codes).getByText(code)).toBeInTheDocument();
    expect(confirm).toEqual([{ code: "123456" }]);
    expect(screen.queryByRole("dialog", { name: "Set up an authenticator app" })).toBeNull();
    await waitFor(() => expect(status.mock.calls.length).toBeGreaterThan(1));
  });

  it("a wrong code keeps the setup dialog open with the error", async () => {
    mfaStatusIs(MFA_OFF);
    post("/auth/mfa/totp", () => HttpResponse.json(SETUP));
    post("/auth/mfa/totp/confirm", () =>
      apiError(401, "invalid_credentials", "Invalid authentication code"),
    );
    const { user } = await openAccount();
    await user.click(within(section()).getByRole("button", { name: "Set up" }));
    const dialog = await screen.findByRole("dialog", { name: "Set up an authenticator app" });
    await user.type(within(dialog).getByLabelText("Authentication code"), "000000");
    await user.click(within(dialog).getByRole("button", { name: "Verify" }));
    expect(await within(dialog).findByText("Invalid authentication code")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Save your recovery codes" })).toBeNull();
  });

  it("reauth_required asks for the password, then retries the request exactly once", async () => {
    mfaStatusIs(MFA_OFF);
    const setup = post("/auth/mfa/totp", reauthRequired, () => HttpResponse.json(SETUP));
    const reauth = post("/auth/reauth", () => HttpResponse.json({ reauthUntil: Date.now() + 1 }));
    const { user, queryClient } = await openAccount();
    await user.click(within(section()).getByRole("button", { name: "Set up" }));

    const dialog = await screen.findByRole("dialog", { name: "Confirm it's you" });
    await user.type(within(dialog).getByLabelText("Password"), PASSWORD);
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));

    expect(
      await screen.findByRole("dialog", { name: "Set up an authenticator app" }),
    ).toBeInTheDocument();
    expect(reauth).toEqual([{ method: "password", password: PASSWORD }]);
    expect(setup).toHaveLength(2);
    expect(screen.queryByRole("dialog", { name: "Confirm it's you" })).toBeNull();
    expect(
      JSON.stringify(
        queryClient
          .getMutationCache()
          .getAll()
          .map((m) => m.state.variables),
      ),
    ).not.toContain(PASSWORD);
  });

  it("with MFA on, reauth asks for a code, not the password", async () => {
    mfaStatusIs(TOTP_ON);
    const regenerate = post("/auth/mfa/recovery-codes", reauthRequired, () =>
      HttpResponse.json({ recoveryCodes: CODES }),
    );
    const reauth = post("/auth/reauth", () => HttpResponse.json({ reauthUntil: Date.now() + 1 }));
    const { user } = await openAccount();
    await user.click(within(section()).getByRole("button", { name: "Generate new codes" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: "Generate new recovery codes?" })).getByRole(
        "button",
        { name: "Generate codes" },
      ),
    );
    const dialog = await screen.findByRole("dialog", { name: "Confirm it's you" });
    expect(within(dialog).queryByLabelText("Password")).toBeNull();
    await user.type(within(dialog).getByLabelText("Authentication code"), "654321");
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await screen.findByRole("dialog", { name: "Save your recovery codes" });
    expect(reauth).toEqual([{ method: "totp", code: "654321" }]);
    expect(regenerate).toHaveLength(2);
  });

  it("a wrong reauth code shows the error and does not retry", async () => {
    mfaStatusIs(TOTP_ON);
    const regenerate = post("/auth/mfa/recovery-codes", reauthRequired);
    post("/auth/reauth", () => apiError(401, "invalid_credentials", "Invalid authentication code"));
    const { user } = await openAccount();
    await user.click(within(section()).getByRole("button", { name: "Generate new codes" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: "Generate new recovery codes?" })).getByRole(
        "button",
        { name: "Generate codes" },
      ),
    );
    const dialog = await screen.findByRole("dialog", { name: "Confirm it's you" });
    await user.type(within(dialog).getByLabelText("Authentication code"), "000000");
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(await within(dialog).findByText("Invalid authentication code")).toBeInTheDocument();
    expect(regenerate).toHaveLength(1);
  });

  it("cancelling the reauth dialog drops the request without an error", async () => {
    mfaStatusIs(MFA_OFF);
    const setup = post("/auth/mfa/totp", reauthRequired);
    const { user } = await openAccount();
    await user.click(within(section()).getByRole("button", { name: "Set up" }));
    const dialog = await screen.findByRole("dialog", { name: "Confirm it's you" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(setup).toHaveLength(1);
    expect(screen.queryByText("Confirm it's you to continue")).toBeNull();
  });

  it("turning off asks for confirmation, then refreshes the status", async () => {
    let on = true;
    const status = mfaStatusIs(() => (on ? TOTP_ON : MFA_OFF));
    const remove = vi.fn(() => {
      on = false;
      return new HttpResponse(null, { status: 204 });
    });
    server.use(http.delete("/api/v1/auth/mfa/totp", remove));
    const { user } = await openAccount();
    expect(within(section()).getByText("On")).toBeInTheDocument();
    expect(within(section()).getByText("8 recovery codes left")).toBeInTheDocument();
    await user.click(within(section()).getByRole("button", { name: "Turn off" }));
    const dialog = await screen.findByRole("dialog", { name: "Turn off authenticator app?" });
    expect(remove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(await within(section()).findByText("Off")).toBeInTheDocument();
    expect(status.mock.calls.length).toBeGreaterThan(1);
  });

  it("new recovery codes are shown once and dropped when the dialog closes", async () => {
    mfaStatusIs(TOTP_ON);
    post("/auth/mfa/recovery-codes", () => HttpResponse.json({ recoveryCodes: CODES }));
    const { user } = await openAccount();
    await user.click(within(section()).getByRole("button", { name: "Generate new codes" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: "Generate new recovery codes?" })).getByRole(
        "button",
        { name: "Generate codes" },
      ),
    );
    const codes = await screen.findByRole("dialog", { name: "Save your recovery codes" });
    expect(within(codes).getByText(CODES[0] as string)).toBeInTheDocument();
    expect(within(codes).getByRole("button", { name: "Download" })).toBeInTheDocument();
    expect(within(codes).getByRole("button", { name: "Copy" })).toBeInTheDocument();
    await user.click(within(codes).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByText(CODES[0] as string)).toBeNull();
  });
});

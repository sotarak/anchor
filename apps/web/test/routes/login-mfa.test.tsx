import type { QueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, fixtures, projectExists, renderApp, server, signedOut } from "#test/support";
import { qk } from "@/lib/api/query-keys";
import { getPasskeyAssertion, passkeysSupported } from "@/lib/webauthn";

vi.mock("@/lib/webauthn", () => ({
  passkeysSupported: vi.fn(() => true),
  getPasskeyAssertion: vi.fn(),
  createPasskey: vi.fn(),
}));

const PASSWORD = "correct horse battery";
const TICKET = "anc_mfa_TICKETCANARY";
const CODE = "135790";
const loginResponse = { user: fixtures.owner, expiresAt: Date.now() + 86_400_000 };
const challenge = (methods: string[]) => ({
  mfaRequired: true,
  ticket: TICKET,
  methods,
  expiresAt: Date.now() + 300_000,
});

function expectNotInMutationCache(queryClient: QueryClient, ...secrets: string[]) {
  const cached = JSON.stringify(
    queryClient
      .getMutationCache()
      .getAll()
      .map((m) => m.state.variables),
  );
  for (const secret of secrets) expect(cached).not.toContain(secret);
}

async function toSecondStep(methods = ["totp", "recovery"], url = "/login") {
  signedOut();
  projectExists();
  server.use(http.post("/api/v1/auth/login", () => HttpResponse.json(challenge(methods))));
  const app = await renderApp(url);
  await app.user.type(await screen.findByLabelText("Email"), "owner@example.com");
  await app.user.type(screen.getByLabelText("Password"), PASSWORD);
  await app.user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("heading", { name: "Two-factor authentication" });
  return app;
}

beforeEach(() => {
  vi.mocked(passkeysSupported).mockReturnValue(true);
  vi.mocked(getPasskeyAssertion).mockReset();
});

describe("/login second step", () => {
  it("replaces the password form with a one-time-code field", async () => {
    await toSecondStep();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    const field = screen.getByLabelText("Authentication code");
    expect(field).toHaveAttribute("autocomplete", "one-time-code");
    expect(field).toHaveAttribute("inputmode", "numeric");
  });

  it("a right code signs in, lands on the redirect and caches the user", async () => {
    const sent = vi.fn();
    server.use(
      http.post("/api/v1/auth/login/mfa", async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json(loginResponse);
      }),
    );
    const { user, router, queryClient } = await toSecondStep(
      ["totp", "recovery"],
      "/login?redirect=%2Fprojects%2Fapp",
    );
    await user.type(screen.getByLabelText("Authentication code"), CODE);
    await user.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/projects/app"));
    expect(sent).toHaveBeenCalledWith({ ticket: TICKET, method: "totp", code: CODE });
    expect(queryClient.getQueryData(qk.me)).toEqual(fixtures.owner);
    expectNotInMutationCache(queryClient, CODE, TICKET, PASSWORD);
  });

  it("a wrong code shows the error and keeps the step", async () => {
    server.use(
      http.post("/api/v1/auth/login/mfa", () =>
        apiError(401, "invalid_credentials", "Invalid authentication code"),
      ),
    );
    const { user } = await toSecondStep();
    await user.type(screen.getByLabelText("Authentication code"), "000000");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByText("Invalid authentication code")).toBeInTheDocument();
    expect(screen.getByLabelText("Authentication code")).toBeInTheDocument();
  });

  it("an expired ticket returns to the password form with an empty password", async () => {
    server.use(
      http.post("/api/v1/auth/login/mfa", () =>
        apiError(401, "unauthenticated", "Sign-in expired, start again"),
      ),
    );
    const { user } = await toSecondStep();
    await user.type(screen.getByLabelText("Authentication code"), CODE);
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(
      await screen.findByText("Your sign-in expired. Enter your password again."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("a recovery code can be used instead", async () => {
    const sent = vi.fn();
    server.use(
      http.post("/api/v1/auth/login/mfa", async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json(loginResponse);
      }),
    );
    const { user, router } = await toSecondStep();
    await user.click(screen.getByRole("button", { name: "Use a recovery code" }));
    expect(screen.getByRole("button", { name: "Use your authenticator app" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Recovery code"), "abcde-fghij");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/projects"));
    expect(sent).toHaveBeenCalledWith({ ticket: TICKET, method: "recovery", code: "abcde-fghij" });
  });

  it("the passkey button asks the browser and posts its answer", async () => {
    const assertion = { id: "cred", rawId: "cred", type: "public-key", response: {} };
    vi.mocked(getPasskeyAssertion).mockResolvedValue(assertion);
    const sent = vi.fn();
    server.use(
      http.post("/api/v1/auth/login/passkey/options", () =>
        HttpResponse.json({ options: { challenge: "ch" } }),
      ),
      http.post("/api/v1/auth/login/passkey", async ({ request }) => {
        sent(await request.json());
        return HttpResponse.json(loginResponse);
      }),
    );
    const { user, router } = await toSecondStep(["totp", "passkey", "recovery"]);
    await user.click(screen.getByRole("button", { name: "Use a passkey" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/projects"));
    expect(getPasskeyAssertion).toHaveBeenCalledWith({ challenge: "ch" });
    expect(sent).toHaveBeenCalledWith({ ticket: TICKET, response: assertion });
  });

  it("a cancelled passkey prompt shows no error", async () => {
    vi.mocked(getPasskeyAssertion).mockRejectedValue(
      Object.assign(new Error("cancelled"), { name: "NotAllowedError" }),
    );
    server.use(
      http.post("/api/v1/auth/login/passkey/options", () =>
        HttpResponse.json({ options: { challenge: "ch" } }),
      ),
    );
    const { user } = await toSecondStep(["passkey", "recovery"]);
    await user.click(screen.getByRole("button", { name: "Use a passkey" }));
    await waitFor(() => expect(getPasskeyAssertion).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("no passkey button when the method is not offered", async () => {
    await toSecondStep(["totp", "recovery"]);
    expect(screen.queryByRole("button", { name: "Use a passkey" })).toBeNull();
  });

  it("no passkey button without browser support; a passkey-only account starts on recovery", async () => {
    vi.mocked(passkeysSupported).mockReturnValue(false);
    await toSecondStep(["passkey", "recovery"]);
    expect(screen.queryByRole("button", { name: "Use a passkey" })).toBeNull();
    expect(screen.getByLabelText("Recovery code")).toBeInTheDocument();
  });
});

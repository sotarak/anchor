import type { LoginResponse } from "@anchor/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, json, jsonInit, resetDb } from "#test/support";

const SECRET_CANARY = "LEAK-CANARY-7f3a";
const REFERENCED_CANARY = "LEAK-CANARY-REFERENCED-41d0";
const IMPORTED_CANARY = "LEAK-CANARY-IMPORTED-8e6b";
const PASSWORD_CANARY = "PW-CANARY-9b2c-wrong-password";
const OWNER_PASSWORD = "owner password long enough";
const METHODS = ["log", "info", "warn", "error", "debug"] as const;

describe("no plaintext in logs", () => {
  let spies: ReturnType<typeof vi.spyOn>[] = [];

  beforeEach(async () => {
    await resetDb();
    spies = METHODS.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  });
  afterEach(() => {
    for (const s of spies) s.mockRestore();
  });

  it("secret values, passwords and session tokens never reach console output", async () => {
    const setup = await api(
      "/api/v1/setup",
      jsonInit("POST", {
        email: "owner@example.test",
        name: "Owner",
        password: OWNER_PASSWORD,
      }),
    );
    expect(setup.status).toBe(201);

    const bad = await api(
      "/api/v1/auth/login",
      jsonInit("POST", { email: "owner@example.test", password: PASSWORD_CANARY, client: "cli" }),
    );
    expect(bad.status).toBe(401);

    const login = await api(
      "/api/v1/auth/login",
      jsonInit("POST", { email: "owner@example.test", password: OWNER_PASSWORD, client: "cli" }),
    );
    expect(login.status).toBe(200);
    const { token } = await json<LoginResponse>(login);
    if (!token) throw new Error("cli login returned no token");
    const auth = { token };
    const h = { headers: { authorization: `Bearer ${token}` } };

    expect(
      (await api("/api/v1/projects", jsonInit("POST", { slug: "app", name: "App" }, auth))).status,
    ).toBe(201);
    const url = "/api/v1/projects/app/environments/dev/secrets";
    expect((await api(`${url}/K`, jsonInit("PUT", { value: SECRET_CANARY }, auth))).status).toBe(
      201,
    );
    expect((await api(`${url}/K`, h)).status).toBe(200);
    expect((await api(`${url}?reveal=true`, h)).status).toBe(200);
    expect((await api(`${url}/K`, jsonInit("PUT", { value: SECRET_CANARY }, auth))).status).toBe(
      200,
    );
    expect((await api(`${url}/K`, { ...h, method: "DELETE" })).status).toBe(204);

    // M5: a referenced value and an imported value, read through expansion and imports.
    const prod = "/api/v1/projects/app/environments/prod/secrets";
    const staging = "/api/v1/projects/app/environments/staging/secrets";
    expect(
      (await api(`${prod}/REF`, jsonInit("PUT", { value: REFERENCED_CANARY }, auth))).status,
    ).toBe(201);
    expect(
      (await api(`${staging}/IMP`, jsonInit("PUT", { value: IMPORTED_CANARY }, auth))).status,
    ).toBe(201);
    expect(
      (await api(`${url}/USES`, jsonInit("PUT", { value: "x${prod:/REF}" }, auth))).status,
    ).toBe(201);
    const imports = "/api/v1/projects/app/environments/dev/imports";
    expect(
      (
        await api(
          imports,
          jsonInit("POST", { path: "/", source: { environment: "staging", path: "/" } }, auth),
        )
      ).status,
    ).toBe(201);
    expect((await api(`${url}/USES?expand=true`, h)).status).toBe(200);
    expect((await api(`${url}?reveal=true&expand=true&includeImports=true`, h)).status).toBe(200);
    // A failing expansion (unresolved and forbidden paths) must not log values either.
    expect(
      (await api(`${url}/BROKEN`, jsonInit("PUT", { value: "${prod:/REF}${MISSING}" }, auth)))
        .status,
    ).toBe(201);
    expect((await api(`${url}/BROKEN?expand=true`, h)).status).toBe(400);

    const output = spies
      .flatMap((s) => s.mock.calls)
      .map((args: unknown[]) =>
        args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "),
      )
      .join("\n");
    for (const canary of [
      SECRET_CANARY,
      REFERENCED_CANARY,
      IMPORTED_CANARY,
      PASSWORD_CANARY,
      OWNER_PASSWORD,
      token,
    ]) {
      expect(output).not.toContain(canary);
    }
  });
});

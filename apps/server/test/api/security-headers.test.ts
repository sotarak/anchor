import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "#src/app";
import {
  api,
  createUserWithSession,
  failingAuditDb,
  jsonInit,
  mcpCall,
  oauthTokenFor,
  resetDb,
} from "#test/support";

const HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
};

const form = (body: string): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body,
});

describe("security headers on Worker responses", () => {
  it.each([
    ["GET /api/v1/health", () => api("/api/v1/health"), 200],
    ["GET an unknown /api route", () => api("/api/v1/nope"), 404],
    ["POST /mcp without a token", () => api("/mcp", { method: "POST" }), 401],
    [
      "GET /.well-known/oauth-authorization-server",
      () => api("/.well-known/oauth-authorization-server"),
      200,
    ],
    ["POST /oauth/token with a bad grant", () => api("/oauth/token", form("grant_type=x")), 400],
    [
      "OPTIONS /mcp preflight",
      () =>
        api("/mcp", {
          method: "OPTIONS",
          headers: {
            origin: "https://agent.example",
            "access-control-request-method": "POST",
            "access-control-request-headers": "authorization",
          },
        }),
      204,
    ],
  ] as const)("%s", async (_name, send, status) => {
    const res = await send();
    expect(res.status).toBe(status);
    for (const [name, value] of Object.entries(HEADERS)) {
      expect(res.headers.get(name), name).toBe(value);
    }
  });

  it("a successful MCP response (built by the MCP transport) carries them", async () => {
    await resetDb();
    const { userId } = await createUserWithSession();
    const res = await mcpCall(await oauthTokenFor(userId), "tools/list");
    expect(res.status).toBe(200);
    for (const [name, value] of Object.entries(HEADERS)) {
      expect(res.headers.get(name), name).toBe(value);
    }
  });

  it("a thrown 500 carries them too", async () => {
    await resetDb();
    const failing = { ...env, DB: failingAuditDb(env.DB) };
    const init = jsonInit("POST", { email: "nobody@example.io", password: "wrong password!!" });
    const res = await createApp().request("/api/v1/auth/login", init, failing);
    expect(res.status).toBe(500);
    for (const [name, value] of Object.entries(HEADERS)) {
      expect(res.headers.get(name), name).toBe(value);
    }
  });

  it("CORS on the OAuth endpoints keeps working", async () => {
    const res = await api("/.well-known/oauth-authorization-server", {
      headers: { origin: "https://agent.example" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

import { describe, expect, it } from "vitest";
import { api, json } from "#test/support";

const O = "http://anchor.test";

describe("OAuth metadata", () => {
  it.each(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"])(
    "%s describes the MCP resource",
    async (path) => {
      const res = await api(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(await json(res)).toEqual({
        resource: `${O}/mcp`,
        authorization_servers: [O],
        scopes_supported: ["secrets:read", "secrets:write", "secrets:reveal"],
        bearer_methods_supported: ["header"],
      });
    },
  );

  it("the authorization server metadata lists exactly the spec's endpoints and arrays", async () => {
    const res = await api("/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await json(res)).toEqual({
      issuer: O,
      authorization_endpoint: `${O}/oauth/authorize`,
      token_endpoint: `${O}/oauth/token`,
      registration_endpoint: `${O}/oauth/register`,
      revocation_endpoint: `${O}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["secrets:read", "secrets:write", "secrets:reveal"],
    });
  });

  it("a CORS preflight on the token endpoint is answered for any origin", async () => {
    const res = await api("/oauth/token", {
      method: "OPTIONS",
      headers: {
        origin: "https://client.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });
});

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  api,
  createServiceToken,
  createUserWithSession,
  jsonInit,
  mcpCall,
  oauthTokenFor,
  resetDb,
} from "#test/support";

const RESOURCE_METADATA =
  'resource_metadata="http://anchor.test/.well-known/oauth-protected-resource/mcp"';
let user: { userId: string; token: string; cookie: string };

beforeEach(async () => {
  await resetDb();
  user = await createUserWithSession({ role: "owner", kind: "web" });
});

describe("/mcp authentication", () => {
  it("no token → 401 pointing at the protected resource metadata", async () => {
    const res = await mcpCall(null, "tools/list");
    expect(res.status).toBe(401);
    const header = res.headers.get("www-authenticate") ?? "";
    expect(header).toMatch(/^Bearer /);
    expect(header).toContain(RESOURCE_METADATA);
    expect(header).not.toContain("invalid_token");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-expose-headers")?.toLowerCase()).toContain(
      "www-authenticate",
    );
  });

  it('a bad token adds error="invalid_token"', async () => {
    const res = await mcpCall("anc_oat_nope", "tools/list");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("a session cookie, a CLI session or a service token is refused", async () => {
    const cli = await createUserWithSession({ role: "owner", kind: "cli" });
    await api(
      "/api/v1/projects",
      jsonInit("POST", { name: "app", slug: "app" }, { token: cli.token }),
    );
    const st = await createServiceToken("app", {
      permission: "read",
      scopes: [{ environment: "dev", path: "/" }],
    });
    for (const res of [
      await mcpCall(null, "tools/list", undefined, {
        headers: { cookie: user.cookie, origin: "http://anchor.test" },
      }),
      await mcpCall(user.token, "tools/list"),
      await mcpCall(cli.token, "tools/list"),
      await mcpCall(st.token, "tools/list"),
    ]) {
      expect(res.status).toBe(401);
    }
  });

  it("an OAuth access token on /api/v1/... → 401", async () => {
    const token = await oauthTokenFor(user.userId);
    const res = await api("/api/v1/projects", { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });

  it("GET /mcp → 405", async () => {
    const token = await oauthTokenFor(user.userId);
    const res = await api("/mcp", {
      headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" },
    });
    expect(res.status).toBe(405);
  });

  it("OPTIONS /mcp answers CORS for any origin", async () => {
    const res = await api("/mcp", {
      method: "OPTIONS",
      headers: {
        origin: "https://client.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization, content-type, mcp-protocol-version",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const allowed = res.headers.get("access-control-allow-headers")?.toLowerCase() ?? "";
    for (const h of ["authorization", "content-type", "mcp-protocol-version"]) {
      expect(allowed).toContain(h);
    }
  });

  it("a valid token lists tools; a revoked grant's token → 401", async () => {
    const token = await oauthTokenFor(user.userId);
    const ok = await mcpCall(token, "tools/list");
    expect(ok.status).toBe(200);
    await env.DB.prepare("UPDATE oauth_grants SET revoked_at = 1").run();
    expect((await mcpCall(token, "tools/list")).status).toBe(401);
  });

  it("initialize answers with server name anchor", async () => {
    const token = await oauthTokenFor(user.userId);
    const res = await mcpCall(token, "initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { serverInfo: { name: string; version: string } };
    };
    expect(body.result.serverInfo.name).toBe("anchor");
    expect(body.result.serverInfo.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("last_used_at is set on the grant", async () => {
    const token = await oauthTokenFor(user.userId);
    await mcpCall(token, "tools/list");
    const row = await env.DB.prepare("SELECT last_used_at FROM oauth_grants").first<{
      last_used_at: number | null;
    }>();
    expect(row?.last_used_at).not.toBeNull();
  });
});

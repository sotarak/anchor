import { beforeEach, describe, expect, it } from "vitest";
import {
  api,
  challengeFor,
  createUserWithSession,
  formPost,
  json,
  jsonInit,
  mcpCall,
  mcpTool,
  resetDb,
} from "#test/support";

const REDIRECT = "http://127.0.0.1:47321/oauth/callback";
const VERIFIER = "flow-verifier-0123456789-abcdefghijklmnopqrstuvwxyz";

beforeEach(resetDb);

describe("MCP over OAuth, end to end", () => {
  it("register → approve → token → MCP → refresh → revoke → 401", async () => {
    const web = await createUserWithSession({ role: "owner", kind: "web" });
    const cli = await createUserWithSession({ role: "owner", kind: "cli" });
    await api(
      "/api/v1/projects",
      jsonInit("POST", { name: "app", slug: "app" }, { token: cli.token }),
    );
    await api(
      "/api/v1/projects/app/environments/dev/secrets/LOG_LEVEL",
      jsonInit("PUT", { value: "debug", sensitive: false }, { token: cli.token }),
    );

    // 1. The client discovers the server and registers.
    const prm = await json<{ authorization_servers: string[] }>(
      await api("/.well-known/oauth-protected-resource/mcp"),
    );
    expect(prm.authorization_servers).toEqual(["http://anchor.test"]);
    const reg = await api("/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Codex",
        redirect_uris: ["http://127.0.0.1/oauth/callback"],
      }),
    });
    const { client_id } = await json<{ client_id: string }>(reg);

    // 2. The person approves in the dashboard (loopback redirect on another port).
    const request = {
      response_type: "code",
      client_id,
      redirect_uri: REDIRECT,
      code_challenge: await challengeFor(VERIFIER),
      code_challenge_method: "S256",
      state: "xyz",
      resource: "http://anchor.test/mcp",
    };
    const check = await api(
      "/api/v1/oauth/authorize/check",
      jsonInit("POST", request, { cookie: web.cookie }),
    );
    expect(check.status).toBe(200);
    const decision = await json<{ redirectTo: string }>(
      await api(
        "/api/v1/oauth/authorize/decision",
        jsonInit("POST", { ...request, approve: true, allowReveal: false }, { cookie: web.cookie }),
      ),
    );
    const back = new URL(decision.redirectTo);
    expect(back.searchParams.get("state")).toBe("xyz");

    // 3. The client exchanges the code.
    const pair = await json<{ access_token: string; refresh_token: string; scope: string }>(
      await formPost("/oauth/token", {
        grant_type: "authorization_code",
        code: back.searchParams.get("code") ?? "",
        redirect_uri: REDIRECT,
        client_id,
        code_verifier: VERIFIER,
        resource: "http://anchor.test/mcp",
      }),
    );
    expect(pair.scope).toBe("secrets:read secrets:write");

    // 4. MCP calls.
    const init = await mcpCall(pair.access_token, "initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "codex", version: "1" },
    });
    expect(init.status).toBe(200);
    expect((await mcpCall(pair.access_token, "tools/list")).status).toBe(200);
    const list = await mcpTool(pair.access_token, "list_secrets", {
      project: "app",
      environment: "dev",
    });
    expect(list.data).toMatchObject({ secrets: [{ key: "LOG_LEVEL", value: "debug" }] });

    // 5. Refresh, then revoke: the newest access token stops working.
    const next = await json<{ access_token: string; refresh_token: string }>(
      await formPost("/oauth/token", {
        grant_type: "refresh_token",
        refresh_token: pair.refresh_token,
        client_id,
      }),
    );
    expect((await mcpCall(next.access_token, "tools/list")).status).toBe(200);
    expect((await formPost("/oauth/revoke", { token: next.refresh_token })).status).toBe(200);
    expect((await mcpCall(next.access_token, "tools/list")).status).toBe(401);
  });
});

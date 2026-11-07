import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv } from "../env";
import { requestContext } from "../lib/request";
import { authenticateAccessToken } from "../oauth/store";
import { findUserById } from "../users/repo";
import { buildMcpServer } from "./server";

/**
 * The MCP endpoint (spec 2026-11-07-v0.4.0-mcp-oauth): Streamable HTTP, stateless, JSON
 * responses. Only OAuth access tokens (`anc_oat_`) are accepted, as a bearer header; cookies,
 * CLI sessions and service tokens are refused here.
 */
export const mcpRoutes = new Hono<AppEnv>();

mcpRoutes.use(
  "/mcp",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["authorization", "content-type", "mcp-protocol-version", "mcp-session-id"],
    exposeHeaders: ["www-authenticate", "mcp-session-id"],
    maxAge: 86_400,
  }),
);
mcpRoutes.use("/mcp", requestContext);

function unauthorized(c: Context<AppEnv>, tokenPresented: boolean) {
  const metadata = `${new URL(c.req.url).origin}/.well-known/oauth-protected-resource/mcp`;
  const params = [`resource_metadata="${metadata}"`];
  if (tokenPresented) params.push('error="invalid_token"');
  c.header("WWW-Authenticate", `Bearer ${params.join(", ")}`);
  return c.json(
    {
      error: tokenPresented ? "invalid_token" : "unauthorized",
      error_description: "Connect with OAuth to use Anchor's MCP server",
    },
    401,
  );
}

mcpRoutes.all("/mcp", async (c) => {
  // Stateless: no server-sent event stream to open and no session to delete.
  if (c.req.method !== "POST") {
    c.header("Allow", "POST, OPTIONS");
    return c.json({ error: "method_not_allowed" }, 405);
  }
  const header = c.req.header("authorization");
  if (header === undefined) return unauthorized(c, false);
  const token = /^Bearer (\S+)$/.exec(header)?.[1];
  const auth = token ? await authenticateAccessToken(c.env.DB, token, Date.now()) : null;
  const user = auth ? await findUserById(c.env.DB, auth.userId) : null;
  if (!token || !auth || !user) return unauthorized(c, true);

  c.set("principal", {
    type: "user",
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    // Not a session: no session row exists, and requireWebUser refuses bearer callers anyway.
    sessionId: `oauth:${auth.grantId}`,
  });
  c.set("authVia", "bearer");
  c.set("oauth", { grantId: auth.grantId, clientId: auth.clientId, scopes: auth.scopes });

  const server = buildMcpServer(c, auth);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(c.req.raw, {
    authInfo: { token, clientId: auth.clientId, scopes: auth.scopes },
  });
});

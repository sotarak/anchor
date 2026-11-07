import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Context } from "hono";
import type { AppEnv } from "../env";
import type { OAuthAuth } from "../oauth/store";
import { SERVER_VERSION } from "../version";
import { registerReadTools } from "./tools-read";
import { registerWriteTools } from "./tools-write";

/** One MCP server per request (stateless): its tools act as the grant's user, within its scopes. */
export function buildMcpServer(c: Context<AppEnv>, auth: OAuthAuth): McpServer {
  const server = new McpServer(
    { name: "anchor", version: SERVER_VERSION },
    {
      instructions:
        "Anchor stores a team's secrets and configuration by project, environment and folder. " +
        "Sensitive values are hidden unless the person granted secrets:reveal; never repeat a " +
        "revealed value back unless the person asks for it.",
    },
  );
  const ctx = { c, scopes: auth.scopes };
  registerReadTools(server, ctx);
  registerWriteTools(server, ctx);
  return server;
}

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Context } from "hono";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/errors";
import { log } from "../lib/log";
import type { OAuthScope } from "../oauth/scopes";

/** What every tool runs with: the request (principal = approving user) and the grant's scopes. */
export type ToolContext = { c: Context<AppEnv>; scopes: OAuthScope[] };

/** A refusal shown to the agent as a tool error. Its message never contains a value. */
export class ToolRefusal extends Error {}

const RECONNECT = "Remove and reconnect the Anchor MCP server";

export const SCOPE_MESSAGES: Record<OAuthScope, string> = {
  "secrets:read": `This needs the secrets:read permission. ${RECONNECT}.`,
  "secrets:write": `This needs the secrets:write permission. ${RECONNECT}.`,
  "secrets:reveal": `This needs the secrets:reveal permission. ${RECONNECT}, and tick "Also allow reading sensitive values".`,
};

export function requireScope(ctx: ToolContext, scope: OAuthScope): void {
  if (!ctx.scopes.includes(scope)) throw new ToolRefusal(SCOPE_MESSAGES[scope]);
}

const textResult = (text: string, isError = false): CallToolResult => ({
  ...(isError ? { isError: true } : {}),
  content: [{ type: "text", text }],
});

/**
 * Runs a tool body: its value becomes JSON text; API errors (404, 403, 400) and refusals become
 * tool errors with their message, as the REST API would say it. Anything else is logged by name
 * only and reported as an internal error, so no value can leak through an exception message.
 */
export async function runTool(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return textResult(JSON.stringify(await fn()));
  } catch (e) {
    if (e instanceof ApiError || e instanceof ToolRefusal) return textResult(e.message, true);
    log("error", "mcp_tool_failed", { error: e instanceof Error ? e.name : "unknown" });
    return textResult("Internal error", true);
  }
}

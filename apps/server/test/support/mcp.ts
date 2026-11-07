import { api } from "./http";

export const MCP_PROTOCOL = "2025-11-25";

/** POSTs one JSON-RPC 2.0 request to /mcp, as a Streamable HTTP client would. */
export function mcpCall(
  token: string | null,
  method: string,
  params?: object,
  init: RequestInit = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": MCP_PROTOCOL,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return api("/mcp", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
  });
}

export type ToolResult = { isError: boolean; text: string; data: unknown };

/** Calls one tool and returns its text content, parsed as JSON when it is JSON. */
export async function mcpTool(token: string, name: string, args: object = {}): Promise<ToolResult> {
  const res = await mcpCall(token, "tools/call", { name, arguments: args });
  if (res.status !== 200)
    throw new Error(`tools/call ${name}: HTTP ${res.status} ${await res.text()}`);
  const body = (await res.json()) as {
    result?: { isError?: boolean; content: { type: string; text: string }[] };
    error?: { message: string };
  };
  if (!body.result) throw new Error(`tools/call ${name}: ${body.error?.message}`);
  const text = body.result.content.map((c) => c.text).join("\n");
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {}
  return { isError: body.result.isError === true, text, data };
}

import { putSecretBodySchema, secretValueTypeSchema } from "@anchor/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { check } from "../lib/validate";
import { removeSecret, resolveTargetBySlugs, writeSecret } from "../secrets/routes";
import { requireScope, runTool, type ToolContext } from "./tool-kit";
import { environmentArg, keyArg, pathArg, projectArg } from "./tools-read";

/**
 * Write tools. They call the same functions as PUT and DELETE /secrets/:key, so project roles,
 * environment restrictions, validation and audit are identical: a viewer's agent cannot write
 * even with secrets:write.
 */
export function registerWriteTools(server: McpServer, ctx: ToolContext): void {
  const { c } = ctx;

  server.registerTool(
    "set_secret",
    {
      description:
        "Create or update a secret. New secrets are sensitive unless sensitive: false; type and sensitive are kept from the current version when omitted.",
      inputSchema: {
        project: projectArg,
        environment: environmentArg,
        path: pathArg,
        key: keyArg,
        value: z.string().describe("The value to store"),
        type: secretValueTypeSchema
          .optional()
          .describe("string (default), json, pem, number, boolean or list"),
        sensitive: z.boolean().optional().describe("false for plain configuration"),
        comment: z.string().max(500).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    ({ project, environment, path, key, value, type, sensitive, comment }) =>
      runTool(async () => {
        requireScope(ctx, "secrets:write");
        const body = check(putSecretBodySchema, { value, path, type, sensitive, comment });
        const target = await resolveTargetBySlugs(c, project, environment);
        const { secret, created, changed } = await writeSecret(c, target, key, body);
        return { result: created ? "created" : changed ? "updated" : "unchanged", secret };
      }),
  );

  server.registerTool(
    "delete_secret",
    {
      description: "Delete a secret and its history from a folder.",
      inputSchema: { project: projectArg, environment: environmentArg, path: pathArg, key: keyArg },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    ({ project, environment, path, key }) =>
      runTool(async () => {
        requireScope(ctx, "secrets:write");
        const target = await resolveTargetBySlugs(c, project, environment);
        await removeSecret(c, target, key, path);
        return { result: "deleted", key, path };
      }),
  );
}

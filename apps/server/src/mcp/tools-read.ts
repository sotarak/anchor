import { secretKeySchema, secretPathSchema } from "@anchor/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { authorize } from "../authz/policy";
import { listChildFolders } from "../folders/repo";
import { listProjectsWithAccess, listVisibleEnvironments } from "../projects/routes";
import { readSecret, resolveTargetBySlugs, secretContext } from "../secrets/routes";
import { listVersions } from "../secrets/versions";
import { composeSecret, composeSecrets } from "../secrets/view";
import { requireScope, runTool, type ToolContext } from "./tool-kit";

/** Tool input fields; snake_case like most MCP servers. */
export const projectArg = z.string().min(1).describe("Project slug");
export const environmentArg = z.string().min(1).describe("Environment slug, e.g. prod");
export const pathArg = secretPathSchema.default("/").describe("Folder path, default /");
export const keyArg = secretKeySchema.describe("Secret key, e.g. DATABASE_URL");
const includeImportsArg = z
  .boolean()
  .default(false)
  .describe("Also include secrets this folder imports from other folders");

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

/** The read tools: structure, metadata and non-sensitive values. Never a sensitive value. */
export function registerReadTools(server: McpServer, ctx: ToolContext): void {
  const { c } = ctx;

  server.registerTool(
    "list_projects",
    {
      description: "List the Anchor projects you can access, with your role in each.",
      annotations: READ_ONLY,
    },
    () =>
      runTool(async () => {
        requireScope(ctx, "secrets:read");
        const projects = await listProjectsWithAccess(c);
        return {
          projects: projects.map((p) => ({
            slug: p.slug,
            name: p.name,
            role: p.access?.role ?? null,
          })),
        };
      }),
  );

  server.registerTool(
    "list_environments",
    {
      description: "List a project's environments you can read.",
      inputSchema: { project: projectArg },
      annotations: READ_ONLY,
    },
    ({ project }) =>
      runTool(async () => {
        requireScope(ctx, "secrets:read");
        const environments = await listVisibleEnvironments(c, project);
        return { environments: environments.map((e) => ({ slug: e.slug, name: e.name })) };
      }),
  );

  server.registerTool(
    "list_folders",
    {
      description: "List the subfolders directly below a folder of an environment.",
      inputSchema: { project: projectArg, environment: environmentArg, path: pathArg },
      annotations: READ_ONLY,
    },
    ({ project, environment, path }) =>
      runTool(async () => {
        requireScope(ctx, "secrets:read");
        const target = await resolveTargetBySlugs(c, project, environment);
        await authorize(c.env.DB, target.principal, "secret:read", {
          projectId: target.project.id,
          environmentId: target.environment.id,
          path,
        });
        const folders = await listChildFolders(c.env.DB, target.environment.id, path);
        return { folders: folders.map((f) => f.path) };
      }),
  );

  server.registerTool(
    "list_secrets",
    {
      description:
        "List the secrets of a folder: key, type, whether it is sensitive, version, comment, and the value of non-sensitive secrets only. References like ${KEY} are not expanded.",
      inputSchema: {
        project: projectArg,
        environment: environmentArg,
        path: pathArg,
        include_imports: includeImportsArg,
      },
      annotations: READ_ONLY,
    },
    ({ project, environment, path, include_imports }) =>
      runTool(async () => {
        requireScope(ctx, "secrets:read");
        const target = await resolveTargetBySlugs(c, project, environment);
        const sc = await secretContext(c, target, "secret:read", path);
        // reveal: false → only non-sensitive values, as stored (never expanded).
        const { secrets } = await composeSecrets(
          { ...sc, principal: target.principal },
          { path, reveal: false, expand: false, includeImports: include_imports },
        );
        return { secrets };
      }),
  );

  server.registerTool(
    "get_secret",
    {
      description:
        "Get one secret's metadata, and its value when it is not sensitive. A sensitive value needs reveal: true and the secrets:reveal permission; that read is audited.",
      inputSchema: {
        project: projectArg,
        environment: environmentArg,
        path: pathArg,
        key: keyArg,
        include_imports: includeImportsArg,
        reveal: z
          .boolean()
          .default(false)
          .describe("Return a sensitive value, with ${...} references expanded (audited)"),
      },
      annotations: READ_ONLY,
    },
    ({ project, environment, path, key, include_imports, reveal }) =>
      runTool(async () => {
        requireScope(ctx, "secrets:read");
        if (reveal) requireScope(ctx, "secrets:reveal");
        const target = await resolveTargetBySlugs(c, project, environment);
        if (reveal) {
          // The REST reveal path: expanded, and audited as secret.read before it is returned.
          return readSecret(c, target, {
            path,
            key,
            expand: true,
            includeImports: include_imports,
          });
        }
        const sc = await secretContext(c, target, "secret:read", path);
        const { secret } = await composeSecret(
          { ...sc, principal: target.principal },
          { path, key, expand: false, includeImports: include_imports },
        );
        // Without reveal a sensitive value never leaves; a non-sensitive one is the stored text.
        if (secret.sensitive) delete secret.value;
        return secret;
      }),
  );

  server.registerTool(
    "secret_history",
    {
      description: "List a secret's versions (who changed it and when), without values.",
      inputSchema: { project: projectArg, environment: environmentArg, path: pathArg, key: keyArg },
      annotations: READ_ONLY,
    },
    ({ project, environment, path, key }) =>
      runTool(async () => {
        requireScope(ctx, "secrets:read");
        const target = await resolveTargetBySlugs(c, project, environment);
        const sc = await secretContext(c, target, "secret:read", path);
        return { versions: await listVersions(sc, { path, key }) };
      }),
  );
}

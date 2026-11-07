import {
  createFolderBodySchema,
  deleteFolderQuerySchema,
  type FolderDto,
  folderQuerySchema,
} from "@anchor/shared";
import { Hono } from "hono";
import { capKeys, recordAudit } from "../audit/record";
import { authorize } from "../authz/policy";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/errors";
import { parseJson, parseQuery } from "../lib/validate";
import { resolveTarget } from "../secrets/routes";
import { deleteFolder, ensureFolders, folderExists, listChildFolders } from "./repo";

/** Mounted at /api/v1/projects/:project/environments/:env/folders. */
export const folderRoutes = new Hono<AppEnv>();

folderRoutes.get("/", async (c) => {
  const { principal, project, environment } = await resolveTarget(c);
  const { path } = parseQuery(c, folderQuerySchema);
  await authorize(c.env.DB, principal, "secret:read", {
    projectId: project.id,
    environmentId: environment.id,
    path,
  });
  const folders = await listChildFolders(c.env.DB, environment.id, path);
  return c.json<{ folders: FolderDto[] }>({ folders });
});

folderRoutes.post("/", async (c) => {
  const { principal, project, environment } = await resolveTarget(c);
  const { path } = await parseJson(c, createFolderBodySchema);
  await authorize(c.env.DB, principal, "secret:write", {
    projectId: project.id,
    environmentId: environment.id,
    path,
  });
  const existed = await folderExists(c.env.DB, environment.id, path);
  if (!existed) {
    await c.env.DB.batch(ensureFolders(c.env.DB, environment.id, path, Date.now()));
    await recordAudit(c, {
      action: "folder.created",
      projectId: project.id,
      environmentId: environment.id,
      target: path,
      metadata: { path },
    });
  }
  const folder: FolderDto = { path, name: path.slice(path.lastIndexOf("/") + 1) };
  return c.json<{ folder: FolderDto }>({ folder }, existed ? 200 : 201);
});

folderRoutes.delete("/", async (c) => {
  const { principal, project, environment } = await resolveTarget(c);
  const { path, force } = parseQuery(c, deleteFolderQuerySchema);
  if (path === "/") throw new ApiError(400, "bad_request", "The root folder cannot be deleted");
  await authorize(c.env.DB, principal, "secret:write", {
    projectId: project.id,
    environmentId: environment.id,
    path,
  });
  const result = await deleteFolder(c.env.DB, environment.id, path, force);
  if (result.status === "not_found") throw new ApiError(404, "not_found", "Folder not found");
  if (result.status === "not_empty") throw new ApiError(409, "conflict", "Folder is not empty");
  await recordAudit(c, {
    action: "folder.deleted",
    projectId: project.id,
    environmentId: environment.id,
    target: path,
    metadata: {
      path,
      secretsDeleted: result.secretsDeleted,
      foldersDeleted: result.foldersDeleted,
      // Each secret a forced delete destroyed, as a secret.deleted per key would have recorded.
      ...(result.secrets.length > 0 ? capKeys(result.secrets) : {}),
    },
  });
  return c.body(null, 204);
});

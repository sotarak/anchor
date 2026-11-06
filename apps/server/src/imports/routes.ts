import { createImportBodySchema, type FolderImportDto, importQuerySchema } from "@anchor/shared";
import { Hono } from "hono";
import { recordAudit } from "../audit/record";
import { authorize } from "../authz/policy";
import type { AppEnv } from "../env";
import { parseJson, parseQuery } from "../lib/validate";
import { getEnvironmentBySlug } from "../projects/repo";
import { resolveTarget } from "../secrets/routes";
import { createImport, deleteImport, getImport, listImports, toImportDto } from "./repo";

/** Mounted at /api/v1/projects/:project/environments/:env/imports. */
export const importRoutes = new Hono<AppEnv>();

importRoutes.get("/", async (c) => {
  const { principal, project, environment } = await resolveTarget(c);
  const { path } = parseQuery(c, importQuerySchema);
  await authorize(c.env.DB, principal, "secret:read", {
    projectId: project.id,
    environmentId: environment.id,
    path,
  });
  const rows = await listImports(c.env.DB, environment.id, path);
  return c.json<{ imports: FolderImportDto[] }>({ imports: rows.map(toImportDto) });
});

importRoutes.post("/", async (c) => {
  const { principal, project, environment } = await resolveTarget(c);
  const body = await parseJson(c, createImportBodySchema);
  await authorize(c.env.DB, principal, "secret:write", {
    projectId: project.id,
    environmentId: environment.id,
    path: body.path,
  });
  // Environment slugs are scoped to the project, so a source in another project is a 404.
  const source = await getEnvironmentBySlug(c.env.DB, project.id, body.source.environment);
  await authorize(c.env.DB, principal, "secret:read", {
    projectId: project.id,
    environmentId: source.id,
    path: body.source.path,
  });
  const row = await createImport(
    c.env.DB,
    {
      environmentId: environment.id,
      path: body.path,
      sourceEnvironmentId: source.id,
      sourcePath: body.source.path,
    },
    Date.now(),
  );
  const dto = toImportDto(row);
  await recordAudit(c, {
    action: "import.created",
    projectId: project.id,
    environmentId: environment.id,
    target: dto.path,
    metadata: { path: dto.path, source: dto.source },
  });
  return c.json<{ import: FolderImportDto }>({ import: dto }, 201);
});

importRoutes.delete("/:id", async (c) => {
  const { principal, project, environment } = await resolveTarget(c);
  const row = await getImport(c.env.DB, environment.id, c.req.param("id"));
  await authorize(c.env.DB, principal, "secret:write", {
    projectId: project.id,
    environmentId: environment.id,
    path: row.path,
  });
  await deleteImport(c.env.DB, environment.id, row.id);
  const dto = toImportDto(row);
  await recordAudit(c, {
    action: "import.deleted",
    projectId: project.id,
    environmentId: environment.id,
    target: dto.path,
    metadata: { path: dto.path, source: dto.source },
  });
  return c.body(null, 204);
});

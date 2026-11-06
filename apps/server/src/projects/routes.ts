import {
  createEnvironmentBodySchema,
  createProjectBodySchema,
  type EnvironmentDto,
  type ProjectDto,
  updateEnvironmentBodySchema,
  updateProjectBodySchema,
} from "@anchor/shared";
import { Hono } from "hono";
import { recordAudit } from "../audit/record";
import { requirePrincipal } from "../auth/middleware";
import { authorize, visibleEnvironmentIds } from "../authz/policy";
import { getRootKey } from "../crypto/keyring";
import type { AppEnv } from "../env";
import { parseJson } from "../lib/validate";
import {
  createEnvironment,
  createProject,
  deleteEnvironment,
  deleteProject,
  getEnvironmentBySlug,
  getProjectBySlug,
  listEnvironments,
  listProjectsForPrincipal,
  renameEnvironment,
  toEnvironmentDto,
  toProjectDto,
  updateProjectName,
} from "./repo";

export const projectRoutes = new Hono<AppEnv>();

projectRoutes.get("/", async (c) => {
  const projects = await listProjectsForPrincipal(c.env.DB, requirePrincipal(c));
  return c.json<{ projects: ProjectDto[] }>({ projects: projects.map(toProjectDto) });
});

projectRoutes.post("/", async (c) => {
  await authorize(c.env.DB, requirePrincipal(c), "project:create");
  const body = await parseJson(c, createProjectBodySchema);
  const rootKey = await getRootKey(c.env);
  const project = await createProject(c.env.DB, rootKey, body, Date.now());
  await recordAudit(c, {
    action: "project.created",
    projectId: project.id,
    metadata: { slug: project.slug, name: project.name },
  });
  return c.json<{ project: ProjectDto }>({ project: toProjectDto(project) }, 201);
});

projectRoutes.get("/:project", async (c) => {
  const principal = requirePrincipal(c);
  const project = await getProjectBySlug(c.env.DB, c.req.param("project"));
  await authorize(c.env.DB, principal, "project:read", { projectId: project.id });
  return c.json<{ project: ProjectDto }>({ project: toProjectDto(project) });
});

projectRoutes.patch("/:project", async (c) => {
  const principal = requirePrincipal(c);
  const project = await getProjectBySlug(c.env.DB, c.req.param("project"));
  await authorize(c.env.DB, principal, "project:update", { projectId: project.id });
  const { name } = await parseJson(c, updateProjectBodySchema);
  await updateProjectName(c.env.DB, project.id, name, Date.now());
  await recordAudit(c, {
    action: "project.updated",
    projectId: project.id,
    metadata: { slug: project.slug, name },
  });
  return c.json<{ project: ProjectDto }>({ project: toProjectDto({ ...project, name }) });
});

projectRoutes.delete("/:project", async (c) => {
  const principal = requirePrincipal(c);
  const project = await getProjectBySlug(c.env.DB, c.req.param("project"));
  await authorize(c.env.DB, principal, "project:delete", { projectId: project.id });
  await deleteProject(c.env.DB, project.id);
  await recordAudit(c, {
    action: "project.deleted",
    projectId: project.id,
    metadata: { slug: project.slug, name: project.name },
  });
  return c.body(null, 204);
});

projectRoutes.get("/:project/environments", async (c) => {
  const principal = requirePrincipal(c);
  const project = await getProjectBySlug(c.env.DB, c.req.param("project"));
  await authorize(c.env.DB, principal, "project:read", { projectId: project.id });
  const [environments, visible] = await Promise.all([
    listEnvironments(c.env.DB, project.id),
    visibleEnvironmentIds(c.env.DB, principal, project.id),
  ]);
  const shown = visible === "all" ? environments : environments.filter((e) => visible.has(e.id));
  return c.json<{ environments: EnvironmentDto[] }>({ environments: shown.map(toEnvironmentDto) });
});

projectRoutes.post("/:project/environments", async (c) => {
  const principal = requirePrincipal(c);
  const project = await getProjectBySlug(c.env.DB, c.req.param("project"));
  await authorize(c.env.DB, principal, "environment:manage", { projectId: project.id });
  const body = await parseJson(c, createEnvironmentBodySchema);
  const environment = await createEnvironment(c.env.DB, project.id, body, Date.now());
  await recordAudit(c, {
    action: "environment.created",
    projectId: project.id,
    environmentId: environment.id,
    metadata: { slug: environment.slug, name: environment.name },
  });
  return c.json<{ environment: EnvironmentDto }>(
    { environment: toEnvironmentDto(environment) },
    201,
  );
});

projectRoutes.patch("/:project/environments/:env", async (c) => {
  const principal = requirePrincipal(c);
  const project = await getProjectBySlug(c.env.DB, c.req.param("project"));
  await authorize(c.env.DB, principal, "environment:manage", { projectId: project.id });
  const environment = await getEnvironmentBySlug(c.env.DB, project.id, c.req.param("env"));
  const { name } = await parseJson(c, updateEnvironmentBodySchema);
  await renameEnvironment(c.env.DB, environment.id, name);
  await recordAudit(c, {
    action: "environment.updated",
    projectId: project.id,
    environmentId: environment.id,
    metadata: { slug: environment.slug, name },
  });
  return c.json<{ environment: EnvironmentDto }>({
    environment: toEnvironmentDto({ ...environment, name }),
  });
});

projectRoutes.delete("/:project/environments/:env", async (c) => {
  const principal = requirePrincipal(c);
  const project = await getProjectBySlug(c.env.DB, c.req.param("project"));
  await authorize(c.env.DB, principal, "environment:manage", { projectId: project.id });
  const environment = await getEnvironmentBySlug(c.env.DB, project.id, c.req.param("env"));
  await deleteEnvironment(c.env.DB, project.id, environment.id);
  await recordAudit(c, {
    action: "environment.deleted",
    projectId: project.id,
    environmentId: environment.id,
    metadata: { slug: environment.slug, name: environment.name },
  });
  return c.body(null, 204);
});

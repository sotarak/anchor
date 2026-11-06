import { createProjectBodySchema, type ProjectDto, updateProjectBodySchema } from "@anchor/shared";
import { Hono } from "hono";
import { requireUser } from "../auth/middleware";
import { authorize } from "../authz/policy";
import { getRootKey } from "../crypto/keyring";
import type { AppEnv } from "../env";
import { parseJson } from "../lib/validate";
import {
  createProject,
  deleteProject,
  getProjectBySlug,
  listProjects,
  toProjectDto,
  updateProjectName,
} from "./repo";

export const projectRoutes = new Hono<AppEnv>();

projectRoutes.get("/", async (c) => {
  authorize(requireUser(c), "project:read");
  const projects = await listProjects(c.env.DB);
  return c.json<{ projects: ProjectDto[] }>({ projects: projects.map(toProjectDto) });
});

projectRoutes.post("/", async (c) => {
  authorize(requireUser(c), "project:create");
  const body = await parseJson(c, createProjectBodySchema);
  const rootKey = await getRootKey(c.env);
  const project = await createProject(c.env.DB, rootKey, body, Date.now());
  return c.json<{ project: ProjectDto }>({ project: toProjectDto(project) }, 201);
});

projectRoutes.get("/:project", async (c) => {
  const principal = requireUser(c);
  const project = await getProjectBySlug(c.env.DB, c.req.param("project"));
  authorize(principal, "project:read", { projectId: project.id });
  return c.json<{ project: ProjectDto }>({ project: toProjectDto(project) });
});

projectRoutes.patch("/:project", async (c) => {
  const principal = requireUser(c);
  const project = await getProjectBySlug(c.env.DB, c.req.param("project"));
  authorize(principal, "project:update", { projectId: project.id });
  const { name } = await parseJson(c, updateProjectBodySchema);
  await updateProjectName(c.env.DB, project.id, name, Date.now());
  return c.json<{ project: ProjectDto }>({ project: toProjectDto({ ...project, name }) });
});

projectRoutes.delete("/:project", async (c) => {
  const principal = requireUser(c);
  const project = await getProjectBySlug(c.env.DB, c.req.param("project"));
  authorize(principal, "project:delete", { projectId: project.id });
  await deleteProject(c.env.DB, project.id);
  return c.body(null, 204);
});

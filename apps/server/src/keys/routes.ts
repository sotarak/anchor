import type { KeyRotationDto, ProjectKeyDto } from "@anchor/shared";
import { Hono } from "hono";
import { recordAudit } from "../audit/record";
import { requirePrincipal } from "../auth/middleware";
import { authorize } from "../authz/policy";
import { getRootKeyring } from "../crypto/keyring";
import type { AppEnv } from "../env";
import { getProjectBySlug } from "../projects/repo";
import { getKeyStatus, startOrResumeRotation } from "./rotation";

/** Mounted at /api/v1/projects/:project/keys. Project admins only. */
export const keyRoutes = new Hono<AppEnv>();

keyRoutes.get("/", async (c) => {
  const principal = requirePrincipal(c);
  const project = await getProjectBySlug(c.env.DB, c.req.param("project") ?? "");
  await authorize(c.env.DB, principal, "project:update", { projectId: project.id });
  const status = await getKeyStatus(c.env.DB, project.id);
  return c.json<{ keys: ProjectKeyDto[]; rotations: KeyRotationDto[] }>(status);
});

keyRoutes.post("/rotate", async (c) => {
  const principal = requirePrincipal(c);
  const project = await getProjectBySlug(c.env.DB, c.req.param("project") ?? "");
  await authorize(c.env.DB, principal, "project:update", { projectId: project.id });
  const keyring = await getRootKeyring(c.env);
  const { rotation, resumed } = await startOrResumeRotation(
    c.env.DB,
    keyring,
    c.env.REENCRYPT_QUEUE,
    project,
    Date.now(),
  );
  if (!resumed) {
    await recordAudit(c, {
      action: "kek.rotation_started",
      projectId: project.id,
      metadata: {
        fromVersion: rotation.fromVersion,
        toVersion: rotation.toVersion,
        total: rotation.total,
      },
    });
  }
  return c.json<{ rotation: KeyRotationDto }>({ rotation }, 202);
});

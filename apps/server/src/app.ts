import { Hono } from "hono";
import { adminRoutes } from "./admin/routes";
import { instanceAuditRoutes, projectAuditRoutes } from "./audit/routes";
import { authenticate, checkOrigin } from "./auth/middleware";
import { authRoutes } from "./auth/routes";
import type { AppEnv } from "./env";
import { folderRoutes } from "./folders/routes";
import { importRoutes } from "./imports/routes";
import { inviteRoutes } from "./invites/routes";
import { keyRoutes } from "./keys/routes";
import { errorHandler, notFoundHandler } from "./lib/errors";
import { requestContext } from "./lib/request";
import { memberRoutes } from "./members/routes";
import { projectRoutes } from "./projects/routes";
import { secretRoutes } from "./secrets/routes";
import { serviceTokenRoutes } from "./service-tokens/routes";
import { userRoutes } from "./users/routes";

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("/api/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });

  app.use("/api/*", requestContext);
  app.use("/api/*", authenticate);
  app.use("/api/*", checkOrigin);

  app.get("/api/v1/health", (c) => c.json({ status: "ok" }));
  app.route("/api/v1", authRoutes);
  app.route("/api/v1/projects/:project/environments/:env/secrets", secretRoutes);
  app.route("/api/v1/projects/:project/environments/:env/folders", folderRoutes);
  app.route("/api/v1/projects/:project/environments/:env/imports", importRoutes);
  app.route("/api/v1/projects/:project/service-tokens", serviceTokenRoutes);
  app.route("/api/v1/projects/:project/keys", keyRoutes);
  app.route("/api/v1/projects/:project/members", memberRoutes);
  app.route("/api/v1/projects/:project/audit", projectAuditRoutes);
  app.route("/api/v1/projects", projectRoutes);
  app.route("/api/v1/users", userRoutes);
  app.route("/api/v1/invites", inviteRoutes);
  app.route("/api/v1/audit", instanceAuditRoutes);
  app.route("/api/v1/admin", adminRoutes);

  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  return app;
}

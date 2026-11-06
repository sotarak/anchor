import { Hono } from "hono";
import { authenticate, checkOrigin } from "./auth/middleware";
import { authRoutes } from "./auth/routes";
import type { AppEnv } from "./env";
import { errorHandler, notFoundHandler } from "./lib/errors";
import { requestContext } from "./lib/request";
import { projectRoutes } from "./projects/routes";
import { secretRoutes } from "./secrets/routes";
import { serviceTokenRoutes } from "./service-tokens/routes";

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
  app.route("/api/v1/projects/:project/service-tokens", serviceTokenRoutes);
  app.route("/api/v1/projects", projectRoutes);

  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  return app;
}

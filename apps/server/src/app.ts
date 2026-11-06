import { Hono } from "hono";
import type { AppEnv } from "./env";
import { errorHandler, notFoundHandler } from "./lib/errors";

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("/api/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });

  app.get("/api/v1/health", (c) => c.json({ status: "ok" }));

  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  return app;
}

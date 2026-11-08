import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";

/**
 * Set on every response the Worker itself produces (`/api/*`, `/oauth/*`, `/mcp`,
 * `/.well-known/*`), errors included. The dashboard's static assets get theirs from
 * apps/web/public/_headers. Not Hono's secureHeaders: its CORP/COOP defaults do not belong on
 * the CORS endpoints MCP clients call from other origins.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(name, value);
};

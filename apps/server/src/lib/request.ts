import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { newId } from "./random";

const MAX_USER_AGENT = 512;

/** Per-request facts for audit rows: request id (cf-ray), client ip and user agent. */
export const requestContext: MiddlewareHandler<AppEnv> = async (c, next) => {
  const requestId = c.req.header("cf-ray") ?? newId();
  c.set("requestId", requestId);
  c.set("clientIp", c.req.header("cf-connecting-ip") ?? null);
  c.set("userAgent", c.req.header("user-agent")?.slice(0, MAX_USER_AGENT) ?? null);
  await next();
  c.header("x-request-id", requestId);
};

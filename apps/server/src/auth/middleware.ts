import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { AppEnv, Principal, UserPrincipal } from "../env";
import { ApiError } from "../lib/errors";
import { findPrincipalByServiceToken } from "../service-tokens/repo";
import { findPrincipalBySessionToken, SESSION_COOKIE } from "./sessions";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** The credential the request presents: the Authorization header wins over the cookie. */
export function readPresentedToken(c: Context): { token: string; via: "cookie" | "bearer" } | null {
  const header = c.req.header("authorization");
  if (header !== undefined) {
    const match = /^Bearer (\S+)$/.exec(header);
    return match?.[1] ? { token: match[1], via: "bearer" } : null;
  }
  const cookie = getCookie(c, SESSION_COOKIE);
  return cookie ? { token: cookie, via: "cookie" } : null;
}

/** Sets c.var.principal/authVia for a valid credential. Never throws for missing/bad ones. */
export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const presented = readPresentedToken(c);
  if (presented) {
    const now = Date.now();
    // Service tokens are bearer-only; a cookie can only ever carry a session.
    const principal =
      presented.via === "bearer" && presented.token.startsWith("anc_st_")
        ? await findPrincipalByServiceToken(c.env.DB, presented.token, now)
        : await findPrincipalBySessionToken(c.env.DB, presented.token, now);
    if (principal) {
      c.set("principal", principal);
      c.set("authVia", presented.via);
    }
  }
  await next();
};

/** CSRF defence: cookie-authenticated unsafe requests must come from our own origin. */
export const checkOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (UNSAFE_METHODS.has(c.req.method) && c.get("authVia") === "cookie") {
    if (c.req.header("origin") !== new URL(c.req.url).origin) {
      throw new ApiError(403, "forbidden", "Origin check failed");
    }
  }
  await next();
};

/** Any authenticated caller (user session or service token); 401 otherwise. */
export function requirePrincipal(c: Context<AppEnv>): Principal {
  const principal = c.get("principal");
  if (!principal) throw new ApiError(401, "unauthenticated", "Authentication required");
  return principal;
}

/** A user session only: 401 when unauthenticated, 403 for service tokens. */
export function requireUser(c: Context<AppEnv>): UserPrincipal {
  const principal = requirePrincipal(c);
  if (principal.type !== "user") {
    throw new ApiError(403, "forbidden", "This endpoint requires a user session");
  }
  return principal;
}

import { Hono } from "hono";
import type { AppEnv } from "../env";
import { toUserDto } from "../users/repo";
import { readPresentedToken, requireUser } from "./middleware";
import { clearSessionCookie, revokeSession } from "./sessions";

export const authRoutes = new Hono<AppEnv>();

authRoutes.get("/auth/me", (c) => {
  const p = requireUser(c);
  return c.json({ user: toUserDto({ id: p.userId, email: p.email, name: p.name, role: p.role }) });
});

authRoutes.post("/auth/logout", async (c) => {
  const presented = readPresentedToken(c);
  if (presented) await revokeSession(c.env.DB, presented.token);
  clearSessionCookie(c);
  return c.body(null, 204);
});

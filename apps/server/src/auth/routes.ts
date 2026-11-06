import { type LoginResponse, type SetupStatusDto, setupBodySchema } from "@anchor/shared";
import { Hono } from "hono";
import { hashPassword } from "../crypto/password";
import type { AppEnv } from "../env";
import { utf8Encode } from "../lib/encoding";
import { ApiError } from "../lib/errors";
import { parseJson } from "../lib/validate";
import { insertFirstOwner, toUserDto } from "../users/repo";
import { readPresentedToken, requireUser } from "./middleware";
import { clearSessionCookie, createSession, revokeSession, setSessionCookie } from "./sessions";

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

/** Constant-time string comparison via SHA-256 digests (equal length by construction). */
async function digestsEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", utf8Encode(a)),
    crypto.subtle.digest("SHA-256", utf8Encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(da, db);
}

authRoutes.get("/setup/status", async (c) => {
  const row = await c.env.DB.prepare("SELECT 1 AS one FROM users LIMIT 1").first();
  return c.json<SetupStatusDto>({ needsSetup: row === null });
});

authRoutes.post("/setup", async (c) => {
  const expected = c.env.ANCHOR_SETUP_TOKEN;
  if (!expected) throw new ApiError(503, "setup_disabled", "Setup is disabled");
  const body = await parseJson(c, setupBodySchema);
  if (!(await digestsEqual(body.setupToken, expected))) {
    throw new ApiError(403, "forbidden", "Invalid setup token");
  }
  const now = Date.now();
  const passwordHash = await hashPassword(body.password);
  const userId = await insertFirstOwner(
    c.env.DB,
    { email: body.email, name: body.name, passwordHash },
    now,
  );
  if (!userId) throw new ApiError(409, "conflict", "Instance already set up");
  const { token, expiresAt } = await createSession(
    c.env.DB,
    userId,
    "web",
    c.req.header("user-agent") ?? null,
    now,
  );
  setSessionCookie(c, token, expiresAt);
  const user = toUserDto({ id: userId, email: body.email, name: body.name, role: "owner" });
  return c.json<LoginResponse>({ user, expiresAt }, 201);
});

import {
  type LoginResponse,
  loginBodySchema,
  type ServiceTokenDto,
  type SetupStatusDto,
  setupBodySchema,
} from "@anchor/shared";
import { Hono } from "hono";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "../crypto/password";
import type { AppEnv } from "../env";
import { utf8Encode } from "../lib/encoding";
import { ApiError } from "../lib/errors";
import { parseJson } from "../lib/validate";
import { loadServiceTokenDto } from "../service-tokens/repo";
import {
  findUserByEmail,
  insertFirstOwner,
  reserveLoginAttempt,
  toUserDto,
  updateLoginState,
} from "../users/repo";
import { LOCKOUT_MS, MAX_FAILED_LOGINS } from "./lockout";
import { readPresentedToken, requirePrincipal } from "./middleware";
import { clearSessionCookie, createSession, revokeSession, setSessionCookie } from "./sessions";

export const authRoutes = new Hono<AppEnv>();

authRoutes.get("/auth/me", async (c) => {
  const p = requirePrincipal(c);
  if (p.type === "service_token") {
    const serviceToken = await loadServiceTokenDto(c.env.DB, p.tokenId);
    if (!serviceToken) throw new ApiError(401, "unauthenticated", "Authentication required");
    return c.json<{ serviceToken: ServiceTokenDto }>({ serviceToken });
  }
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

const INVALID_CREDENTIALS = "Invalid email or password";

// No checkOrigin special case: it only applies to cookie-authenticated requests.
authRoutes.post("/auth/login", async (c) => {
  const body = await parseJson(c, loginBodySchema);
  const now = Date.now();
  const user = await findUserByEmail(c.env.DB, body.email);
  if (!user) {
    await verifyAgainstDummy(body.password);
    throw new ApiError(401, "invalid_credentials", INVALID_CREDENTIALS);
  }
  // Count the attempt as a failure up front (atomically); a correct password resets it below.
  const limits = { maxFailures: MAX_FAILED_LOGINS, lockoutMs: LOCKOUT_MS };
  if (!(await reserveLoginAttempt(c.env.DB, user.id, now, limits))) {
    throw new ApiError(429, "rate_limited", "Too many failed attempts, try again later");
  }
  if (!(await verifyPassword(body.password, user.password_hash))) {
    throw new ApiError(401, "invalid_credentials", INVALID_CREDENTIALS);
  }
  await updateLoginState(c.env.DB, user.id, { failedLogins: 0, lockedUntil: null });
  const { token, expiresAt } = await createSession(
    c.env.DB,
    user.id,
    body.client,
    c.req.header("user-agent") ?? null,
    now,
  );
  const dto = toUserDto(user);
  if (body.client === "web") {
    setSessionCookie(c, token, expiresAt);
    return c.json<LoginResponse>({ user: dto, expiresAt });
  }
  return c.json<LoginResponse>({ user: dto, token, expiresAt });
});

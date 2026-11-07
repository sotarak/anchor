import {
  changePasswordBodySchema,
  type LoginResponse,
  loginBodySchema,
  resetPasswordBodySchema,
  type ServiceTokenDto,
  type SessionDto,
  type SetupStatusDto,
  setupBodySchema,
} from "@anchor/shared";
import { Hono } from "hono";
import { recordAudit } from "../audit/record";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "../crypto/password";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/errors";
import { parseJson } from "../lib/validate";
import { loadServiceTokenDto } from "../service-tokens/repo";
import { consumePasswordReset } from "../users/password-resets";
import {
  findUserByEmail,
  findUserById,
  insertFirstOwner,
  reserveLoginAttempt,
  setPassword,
  toUserDto,
  updateLoginState,
} from "../users/repo";
import { LOCKOUT_MS, MAX_FAILED_LOGINS } from "./lockout";
import { readPresentedToken, requirePrincipal, requireUser } from "./middleware";
import {
  clearSessionCookie,
  createSession,
  isSessionShortId,
  listSessions,
  revokeSession,
  revokeSessionByShortId,
  revokeUserSessions,
  setSessionCookie,
} from "./sessions";

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
  if (presented) {
    await revokeSession(c.env.DB, presented.token);
    // Audit only a real logout: the presented token resolved to a user session.
    if (c.get("principal")?.type === "user") await recordAudit(c, { action: "auth.logout" });
  }
  clearSessionCookie(c);
  return c.body(null, 204);
});

authRoutes.get("/setup/status", async (c) => {
  const row = await c.env.DB.prepare("SELECT 1 AS one FROM users LIMIT 1").first();
  return c.json<SetupStatusDto>({ needsSetup: row === null });
});

// The first submission creates the owner (no setup token since 0.3.0). insertFirstOwner is one
// atomic INSERT ... WHERE NOT EXISTS, so concurrent requests yield exactly one owner and every
// later request gets 409 without touching the existing account.
authRoutes.post("/setup", async (c) => {
  const body = await parseJson(c, setupBodySchema);
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
  await recordAudit(c, {
    action: "auth.setup",
    actor: { type: "user", id: userId, label: body.email },
    target: userId,
  });
  const user = toUserDto({ id: userId, email: body.email, name: body.name, role: "owner" });
  return c.json<LoginResponse>({ user, expiresAt }, 201);
});

const INVALID_CREDENTIALS = "Invalid email or password";

// No checkOrigin special case: it only applies to cookie-authenticated requests.
authRoutes.post("/auth/login", async (c) => {
  const body = await parseJson(c, loginBodySchema);
  const now = Date.now();
  // The submitted (already lowercased) email is the only identity a failed attempt has.
  const failed = (reason: "invalid_credentials" | "locked" | "disabled") =>
    recordAudit(c, {
      action: "auth.login_failed",
      actor: { type: "anonymous", id: null, label: body.email },
      metadata: { reason },
    });
  const user = await findUserByEmail(c.env.DB, body.email);
  if (!user) {
    await verifyAgainstDummy(body.password);
    await failed("invalid_credentials");
    throw new ApiError(401, "invalid_credentials", INVALID_CREDENTIALS);
  }
  // Count the attempt as a failure up front (atomically); a correct password resets it below.
  const limits = { maxFailures: MAX_FAILED_LOGINS, lockoutMs: LOCKOUT_MS };
  if (!(await reserveLoginAttempt(c.env.DB, user.id, now, limits))) {
    await failed("locked");
    throw new ApiError(429, "rate_limited", "Too many failed attempts, try again later");
  }
  if (!(await verifyPassword(body.password, user.password_hash))) {
    await failed("invalid_credentials");
    throw new ApiError(401, "invalid_credentials", INVALID_CREDENTIALS);
  }
  // Only after the password checks out, so a disabled account is not revealed to guessers.
  if (user.disabled_at !== null) {
    await failed("disabled");
    throw new ApiError(403, "forbidden", "Account disabled");
  }
  await updateLoginState(c.env.DB, user.id, { failedLogins: 0, lockedUntil: null });
  const { token, expiresAt } = await createSession(
    c.env.DB,
    user.id,
    body.client,
    c.req.header("user-agent") ?? null,
    now,
  );
  await recordAudit(c, {
    action: "auth.login",
    actor: { type: "user", id: user.id, label: user.email },
    metadata: { client: body.client },
  });
  const dto = toUserDto(user);
  if (body.client === "web") {
    setSessionCookie(c, token, expiresAt);
    return c.json<LoginResponse>({ user: dto, expiresAt });
  }
  return c.json<LoginResponse>({ user: dto, token, expiresAt });
});

authRoutes.post("/auth/password", async (c) => {
  const principal = requireUser(c);
  const body = await parseJson(c, changePasswordBodySchema);
  const now = Date.now();
  const user = await findUserById(c.env.DB, principal.userId);
  if (!user) throw new ApiError(401, "unauthenticated", "Authentication required");
  // Same lockout as login: the attempt is reserved atomically, a correct password resets it.
  const limits = { maxFailures: MAX_FAILED_LOGINS, lockoutMs: LOCKOUT_MS };
  if (!(await reserveLoginAttempt(c.env.DB, user.id, now, limits))) {
    throw new ApiError(429, "rate_limited", "Too many failed attempts, try again later");
  }
  if (!(await verifyPassword(body.currentPassword, user.password_hash))) {
    throw new ApiError(401, "invalid_credentials", "Current password is incorrect");
  }
  await setPassword(c.env.DB, user.id, await hashPassword(body.newPassword), now);
  await revokeUserSessions(c.env.DB, user.id, principal.sessionId);
  await recordAudit(c, { action: "auth.password_changed", target: user.id });
  return c.body(null, 204);
});

authRoutes.post("/auth/password-reset", async (c) => {
  const body = await parseJson(c, resetPasswordBodySchema);
  const passwordHash = await hashPassword(body.password);
  const userId = await consumePasswordReset(c.env.DB, body.token, passwordHash, Date.now());
  if (!userId) throw new ApiError(404, "not_found", "Link is invalid or has expired");
  await revokeUserSessions(c.env.DB, userId);
  const user = await findUserById(c.env.DB, userId);
  await recordAudit(c, {
    action: "auth.password_reset",
    actor: { type: "user", id: userId, label: user?.email ?? null },
    target: userId,
  });
  return c.body(null, 204);
});

authRoutes.get("/auth/sessions", async (c) => {
  const principal = requireUser(c);
  const sessions = await listSessions(c.env.DB, principal.userId, principal.sessionId);
  return c.json<{ sessions: SessionDto[] }>({ sessions });
});

authRoutes.delete("/auth/sessions/:id", async (c) => {
  const principal = requireUser(c);
  const shortId = c.req.param("id");
  if (!isSessionShortId(shortId)) throw new ApiError(400, "bad_request", "invalid fields: id");
  if (!(await revokeSessionByShortId(c.env.DB, principal.userId, shortId))) {
    throw new ApiError(404, "not_found", "Session not found");
  }
  await recordAudit(c, { action: "session.revoked", target: shortId });
  return c.body(null, 204);
});

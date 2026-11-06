import { env } from "cloudflare:workers";
import type { InstanceRole } from "@anchor/shared";
import { createSession, SESSION_COOKIE } from "#src/auth/sessions";
import { hashPassword } from "#src/crypto/password";
import { insertUser } from "#src/users/repo";

export const TEST_PASSWORD = "correct horse battery staple";

/** Inserts a user (real password hash) and a session for it. */
export async function createUserWithSession(
  opts: {
    role?: InstanceRole;
    kind?: "web" | "cli";
    email?: string;
    password?: string;
    name?: string;
  } = {},
): Promise<{ userId: string; token: string; cookie: string }> {
  const now = Date.now();
  const userId = await insertUser(
    env.DB,
    {
      email: opts.email ?? `${crypto.randomUUID()}@example.test`,
      name: opts.name ?? "Test User",
      passwordHash: await hashPassword(opts.password ?? TEST_PASSWORD),
      role: opts.role ?? "owner",
    },
    now,
  );
  const { token } = await createSession(env.DB, userId, opts.kind ?? "web", null, now);
  return { userId, token, cookie: `${SESSION_COOKIE}=${token}` };
}

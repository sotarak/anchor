import { env, exports } from "cloudflare:workers";
import type { InstanceRole } from "@anchor/shared";
import { createSession, SESSION_COOKIE } from "../src/auth/sessions";
import { hashPassword } from "../src/crypto/password";
import { insertUser } from "../src/users/repo";

export const TEST_ORIGIN = "http://anchor.test";

export function api(path: string, init?: RequestInit): Promise<Response> {
  return exports.default.fetch(new Request(TEST_ORIGIN + path, init));
}

export async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

const TABLES_CHILD_FIRST = [
  "secret_versions",
  "secrets",
  "environments",
  "project_keys",
  "projects",
  "sessions",
  "users",
];

/** Empties every table. Tests must not assume isolated storage between files. */
export async function resetDb(): Promise<void> {
  await env.DB.batch(TABLES_CHILD_FIRST.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
}

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

/** JSON request init with cookie or bearer auth. Cookie requests get Origin unless origin: null. */
export function jsonInit(
  method: string,
  body: unknown,
  auth: { cookie?: string; token?: string; origin?: string | null } = {},
): RequestInit {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth.token) headers.authorization = `Bearer ${auth.token}`;
  if (auth.cookie) {
    headers.cookie = auth.cookie;
    const origin = auth.origin === undefined ? TEST_ORIGIN : auth.origin;
    if (origin !== null) headers.origin = origin;
  } else if (auth.origin) {
    headers.origin = auth.origin;
  }
  return { method, headers, body: body === undefined ? undefined : JSON.stringify(body) };
}

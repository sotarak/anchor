import type { LoginResponse } from "@anchor/shared";
import type { Context } from "hono";
import { recordAudit } from "../audit/record";
import type { AppEnv } from "../env";
import { toUserDto, type UserRow } from "../users/repo";
import { createSession, setSessionCookie } from "./sessions";

export type LoginMethod = "password" | "password+totp" | "password+passkey" | "password+recovery";

/**
 * The end of every password login: creates the session, audits `auth.login`, and answers like
 * `/auth/login` always has (the cookie for `web`, the token in the body for `cli`).
 */
export async function issueLoginSession(
  c: Context<AppEnv>,
  user: UserRow,
  client: "web" | "cli",
  method: LoginMethod,
  now: number,
  extra: Record<string, unknown> = {},
): Promise<Response> {
  const { token, expiresAt } = await createSession(
    c.env.DB,
    user.id,
    client,
    c.req.header("user-agent") ?? null,
    now,
  );
  await recordAudit(c, {
    action: "auth.login",
    actor: { type: "user", id: user.id, label: user.email },
    metadata: { client, method, ...extra },
  });
  const dto = toUserDto(user);
  if (client === "web") {
    setSessionCookie(c, token, expiresAt);
    return c.json<LoginResponse>({ user: dto, expiresAt });
  }
  return c.json<LoginResponse>({ user: dto, token, expiresAt });
}

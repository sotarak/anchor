import {
  type CliLoginStartDto,
  cliLoginStartBodySchema,
  cliLoginTokenBodySchema,
  type LoginResponse,
} from "@anchor/shared";
import { Hono } from "hono";
import { recordAudit } from "../audit/record";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/errors";
import { parseJson } from "../lib/validate";
import { findUserById, toUserDto } from "../users/repo";
import { CLI_LOGIN_INTERVAL_S, exchangeCliLogin, startCliLogin } from "./cli-login";
import { createSession } from "./sessions";

/** Anonymous half of the CLI browser login: start a request, then poll it with the device code. */
export const cliLoginRoutes = new Hono<AppEnv>();

cliLoginRoutes.post("/auth/cli/start", async (c) => {
  const body = await parseJson(c, cliLoginStartBodySchema);
  const { deviceCode, userCode, expiresAt } = await startCliLogin(c.env.DB, {
    clientName: body.clientName ?? null,
    userAgent: c.req.header("user-agent") ?? null,
    ip: c.req.header("cf-connecting-ip") ?? null,
    now: Date.now(),
  });
  const verificationUri = `${new URL(c.req.url).origin}/cli/login`;
  return c.json<CliLoginStartDto>({
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete: `${verificationUri}?code=${userCode}`,
    expiresAt,
    interval: CLI_LOGIN_INTERVAL_S,
  });
});

cliLoginRoutes.post("/auth/cli/token", async (c) => {
  const body = await parseJson(c, cliLoginTokenBodySchema);
  const now = Date.now();
  const result = await exchangeCliLogin(c.env.DB, body.deviceCode, now);
  if (result.status === "pending") return c.json({ status: "pending" as const }, 202);
  const user = await findUserById(c.env.DB, result.userId);
  if (!user) throw new ApiError(404, "not_found", "This login request expired or does not exist");
  const { token, expiresAt } = await createSession(c.env.DB, user.id, "cli", result.userAgent, now);
  await recordAudit(c, {
    action: "auth.login",
    actor: { type: "user", id: user.id, label: user.email },
    metadata: { client: "cli", method: "browser" },
  });
  return c.json<LoginResponse>({ user: toUserDto(user), token, expiresAt });
});

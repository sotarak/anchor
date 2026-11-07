import {
  type CliLoginRequestDto,
  type CliLoginStartDto,
  cliLoginStartBodySchema,
  cliLoginTokenBodySchema,
  type LoginResponse,
  normalizeUserCode,
} from "@anchor/shared";
import { type Context, Hono } from "hono";
import { recordAudit } from "../audit/record";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/errors";
import { parseJson } from "../lib/validate";
import { findUserById, toUserDto } from "../users/repo";
import {
  CLI_LOGIN_INTERVAL_S,
  type CliLoginRow,
  decideCliLogin,
  exchangeCliLogin,
  findPendingCliLogin,
  startCliLogin,
} from "./cli-login";
import { requireWebUser } from "./middleware";
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
  // Disabled between approval and exchange: like password login, no session (the row stays consumed).
  if (user.disabled_at !== null) throw new ApiError(403, "forbidden", "Account disabled");
  const { token, expiresAt } = await createSession(c.env.DB, user.id, "cli", result.userAgent, now);
  await recordAudit(c, {
    action: "auth.login",
    actor: { type: "user", id: user.id, label: user.email },
    metadata: { client: "cli", method: "browser" },
  });
  return c.json<LoginResponse>({ user: toUserDto(user), token, expiresAt });
});

const GONE = "This login request expired or was already used";

/** The pending request a dashboard user is looking at; codes match case- and dash-insensitively. */
async function pendingRequest(c: Context<AppEnv>, now: number): Promise<CliLoginRow> {
  const code = normalizeUserCode(c.req.param("userCode") ?? "");
  const row = code ? await findPendingCliLogin(c.env.DB, code, now) : null;
  if (!row) throw new ApiError(404, "not_found", GONE);
  return row;
}

cliLoginRoutes.get("/auth/cli/requests/:userCode", async (c) => {
  await requireWebUser(c);
  const row = await pendingRequest(c, Date.now());
  return c.json<CliLoginRequestDto>({
    userCode: row.user_code,
    clientName: row.client_name,
    userAgent: row.user_agent,
    ip: row.ip,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  });
});

for (const [verb, decision] of [
  ["approve", "approved"],
  ["deny", "denied"],
] as const) {
  cliLoginRoutes.post(`/auth/cli/requests/:userCode/${verb}`, async (c) => {
    const user = await requireWebUser(c);
    const now = Date.now();
    const row = await pendingRequest(c, now);
    if (!(await decideCliLogin(c.env.DB, row.user_code, decision, user.userId, now))) {
      throw new ApiError(404, "not_found", GONE);
    }
    await recordAudit(c, {
      action: decision === "approved" ? "auth.cli_login_approved" : "auth.cli_login_denied",
      metadata: { clientName: row.client_name, ip: row.ip },
    });
    return c.body(null, 204);
  });
}

import { env } from "cloudflare:workers";
import type { CliLoginRequestDto, CliLoginStartDto, LoginResponse } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  api,
  auditRows,
  createServiceToken,
  createUserWithSession,
  json,
  jsonInit,
  resetDb,
} from "#test/support";

const db = env.DB;
const UA = "anchor-cli/0.4.0";
let web: { userId: string; token: string; cookie: string };
let login: CliLoginStartDto;

const start = () =>
  api("/api/v1/auth/cli/start", {
    ...jsonInit("POST", { clientName: "me@laptop" }),
    headers: {
      "content-type": "application/json",
      "user-agent": UA,
      "cf-connecting-ip": "203.0.113.7",
    },
  });
const poll = () =>
  api("/api/v1/auth/cli/token", jsonInit("POST", { deviceCode: login.deviceCode }));
const request = (code: string, auth: RequestInit = { headers: { cookie: web.cookie } }) =>
  api(`/api/v1/auth/cli/requests/${code}`, auth);
const decide = (
  code: string,
  decision: "approve" | "deny",
  auth: Parameters<typeof jsonInit>[2] = { cookie: web.cookie },
) => api(`/api/v1/auth/cli/requests/${code}/${decision}`, jsonInit("POST", undefined, auth));
const status = async () =>
  (await db.prepare("SELECT status FROM cli_logins").first<{ status: string }>())?.status;
const errorOf = async (res: Response) =>
  (await json<{ error: { code: string; message: string } }>(res)).error;

beforeEach(async () => {
  await resetDb();
  web = await createUserWithSession({ role: "member", kind: "web", email: "web@example.test" });
  login = await json<CliLoginStartDto>(await start());
});

describe("CLI login: approval from the dashboard", () => {
  it("a web session sees a pending request", async () => {
    const res = await request(login.userCode);
    expect(res.status).toBe(200);
    const dto = await json<CliLoginRequestDto>(res);
    expect(dto).toMatchObject({
      userCode: login.userCode,
      clientName: "me@laptop",
      userAgent: UA,
      ip: "203.0.113.7",
      expiresAt: login.expiresAt,
    });
    expect(typeof dto.createdAt).toBe("number");
    expect(JSON.stringify(dto)).not.toContain(login.deviceCode);
  });

  it("approve then poll logs in as the approver", async () => {
    expect((await decide(login.userCode, "approve")).status).toBe(204);
    const res = await poll();
    expect(res.status).toBe(200);
    expect((await json<LoginResponse>(res)).user.email).toBe("web@example.test");
    const [event] = await auditRows("auth.cli_login_approved");
    const metadata = JSON.parse(event?.metadata ?? "null");
    expect(metadata).toMatchObject({ clientName: "me@laptop", ip: "203.0.113.7" });
    expect(event?.metadata).not.toContain(login.deviceCode);
  });

  it("deny", async () => {
    expect((await decide(login.userCode, "deny")).status).toBe(204);
    expect((await poll()).status).toBe(403);
    expect(await auditRows("auth.cli_login_denied")).toHaveLength(1);
  });

  it("codes match loosely in the path", async () => {
    await db.prepare("UPDATE cli_logins SET user_code = 'WDJB-MJHT'").run();
    for (const code of ["wdjbmjht", "WDJB-MJHT", "wdjb-mjht"]) {
      expect((await request(code)).status, code).toBe(200);
    }
    expect((await request("not-a-code")).status).toBe(404);
  });

  it("approve without Origin fails the CSRF check", async () => {
    const res = await decide(login.userCode, "approve", { cookie: web.cookie, origin: null });
    expect(res.status).toBe(403);
    expect((await errorOf(res)).message).toBe("Origin check failed");
    expect(await status()).toBe("pending");
  });

  it("a CLI token cannot approve", async () => {
    const cli = await createUserWithSession({ role: "owner", kind: "cli" });
    const bearer = await decide(login.userCode, "approve", { token: cli.token });
    expect(bearer.status).toBe(403);
    expect((await errorOf(bearer)).message).toBe("Approve CLI logins from the dashboard");
    expect((await decide(login.userCode, "approve", { cookie: cli.cookie })).status).toBe(403);
    expect((await request(login.userCode, { headers: { cookie: cli.cookie } })).status).toBe(403);
    // A web session presented as a bearer is not the dashboard either.
    expect((await decide(login.userCode, "approve", { token: web.token })).status).toBe(403);
    const owner = await createUserWithSession({ role: "owner", kind: "cli" });
    await api("/api/v1/projects", jsonInit("POST", { slug: "app", name: "App" }, owner));
    const st = await createServiceToken("app", {
      permission: "read-write",
      scopes: [{ environment: "dev", path: "/" }],
    });
    expect((await decide(login.userCode, "approve", { token: st.token })).status).toBe(403);
    expect(await status()).toBe("pending");
  });

  it("an unauthenticated request is 401", async () => {
    expect((await request(login.userCode, {})).status).toBe(401);
  });

  it("approving an expired, denied or consumed request is 404", async () => {
    await db
      .prepare("UPDATE cli_logins SET expires_at = ?")
      .bind(Date.now() - 1)
      .run();
    expect((await decide(login.userCode, "approve")).status).toBe(404);
    expect((await request(login.userCode)).status).toBe(404);
    for (const s of ["denied", "consumed"]) {
      await db
        .prepare("UPDATE cli_logins SET status = ?, expires_at = ?")
        .bind(s, Date.now() + 60_000)
        .run();
      expect((await decide(login.userCode, "approve")).status, s).toBe(404);
      expect((await decide(login.userCode, "deny")).status, s).toBe(404);
    }
  });

  it("a user disabled after approval gets no session", async () => {
    expect((await decide(login.userCode, "approve")).status).toBe(204);
    await db
      .prepare("UPDATE users SET disabled_at = ? WHERE id = ?")
      .bind(Date.now(), web.userId)
      .run();
    const res = await poll();
    expect(res.status).toBe(403);
    expect((await errorOf(res)).message).toBe("Account disabled");
    const n = await db
      .prepare("SELECT COUNT(*) AS n FROM sessions WHERE kind = 'cli'")
      .first<{ n: number }>();
    expect(n?.n).toBe(0);
    expect(await status()).toBe("consumed");
  });
});

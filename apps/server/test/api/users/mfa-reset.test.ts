import { env } from "cloudflare:workers";
import type { ApiErrorBody, InstanceRole, LoginResponse, UserDto } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { hasMfa } from "#src/mfa/status";
import {
  api,
  auditRows,
  createServiceToken,
  createUserWithSession,
  enablePasskey,
  enableTotp,
  giveRecoveryCodes,
  json,
  jsonInit,
  mcpCall,
  oauthTokenFor,
  resetDb,
  TEST_PASSWORD,
} from "#test/support";

const user = (role: InstanceRole, email: string) =>
  createUserWithSession({ role, kind: "cli", email });
const reset = (t: string, id: string) =>
  api(`/api/v1/users/${id}/mfa-reset`, jsonInit("POST", undefined, { token: t }));
const login = (email: string) =>
  api("/api/v1/auth/login", jsonInit("POST", { email, password: TEST_PASSWORD, client: "cli" }));
const me = (t: string) => api("/api/v1/auth/me", { headers: { authorization: `Bearer ${t}` } });
const errorOf = async (res: Response) => (await json<ApiErrorBody>(res)).error;

let owner: { userId: string; token: string };
beforeEach(async () => {
  await resetDb();
  owner = await user("owner", "owner@example.test");
});

describe("POST /users/:id/mfa-reset", () => {
  it("an owner resets an admin: factors, sessions and agents are gone, login is password-only", async () => {
    const admin = await user("admin", "admin@example.test");
    await enableTotp(admin.userId);
    await enablePasskey(admin.userId);
    await giveRecoveryCodes(admin.userId);
    const agent = await oauthTokenFor(admin.userId);
    const res = await reset(owner.token, admin.userId);
    expect(res.status).toBe(204);
    expect(await hasMfa(env.DB, admin.userId)).toBe(false);
    expect((await me(admin.token)).status).toBe(401);
    expect((await mcpCall(agent, "tools/list")).status).toBe(401);
    const next = await json<LoginResponse & { mfaRequired?: boolean }>(
      await login("admin@example.test"),
    );
    expect(next.mfaRequired).toBeUndefined();
    expect(next.token).toMatch(/^anc_s_/);
    const [event] = await auditRows("mfa.reset");
    expect(event).toMatchObject({ actor_id: owner.userId, target: admin.userId });
    expect(JSON.parse(event?.metadata ?? "null")).toEqual({ userId: admin.userId });
  });

  it("an admin resets a member, not an admin or an owner", async () => {
    const admin = await user("admin", "admin@example.test");
    const member = await user("member", "m@example.test");
    const other = await user("admin", "admin2@example.test");
    await enableTotp(member.userId);
    expect((await reset(admin.token, member.userId)).status).toBe(204);
    const copy = { code: "forbidden", message: "Only an owner can reset an owner or admin" };
    expect(await errorOf(await reset(admin.token, other.userId))).toEqual(copy);
    expect(await errorOf(await reset(admin.token, owner.userId))).toEqual(copy);
  });

  it("refuses self, unknown users, members and service tokens", async () => {
    expect(await errorOf(await reset(owner.token, owner.userId))).toEqual({
      code: "conflict",
      message: "Use your Account page instead",
    });
    expect((await reset(owner.token, "nope")).status).toBe(404);
    const member = await user("member", "m@example.test");
    const target = await user("member", "t@example.test");
    expect((await reset(member.token, target.userId)).status).toBe(403);
    const project = await api(
      "/api/v1/projects",
      jsonInit("POST", { name: "App", slug: "app" }, { token: owner.token }),
    );
    expect(project.status).toBe(201);
    const { token } = await createServiceToken("app", {
      permission: "read",
      scopes: [{ environment: "dev", path: "/" }],
    });
    expect((await reset(token, target.userId)).status).toBe(403);
  });
});

describe("GET /users shows mfaEnabled", () => {
  it("is true for users with a factor and false otherwise", async () => {
    const member = await user("member", "m@example.test");
    await enablePasskey(member.userId);
    const res = await api("/api/v1/users", { headers: { authorization: `Bearer ${owner.token}` } });
    const { users } = await json<{ users: UserDto[] }>(res);
    const byEmail = Object.fromEntries(users.map((u) => [u.email, u.mfaEnabled]));
    expect(byEmail).toEqual({ "m@example.test": true, "owner@example.test": false });
  });
});

describe("pending second steps die with the password or the factors", () => {
  async function pendingTicket(email: string): Promise<string> {
    const res = await api(
      "/api/v1/auth/login",
      jsonInit("POST", { email, password: TEST_PASSWORD }),
    );
    return (await json<{ ticket: string }>(res)).ticket;
  }
  const finish = (ticket: string, code: string) =>
    api("/api/v1/auth/login/mfa", jsonInit("POST", { ticket, method: "recovery", code }));

  it("a password reset, a password change and Reset 2FA all end the ticket", async () => {
    const m = await user("member", "m@example.test");
    await enableTotp(m.userId);
    const codes = await giveRecoveryCodes(m.userId);

    const t1 = await pendingTicket("m@example.test");
    const link = await json<{ url: string }>(
      await api(
        `/api/v1/users/${m.userId}/password-reset`,
        jsonInit("POST", undefined, { token: owner.token }),
      ),
    );
    const token = new URL(link.url).hash.replace("#token=", "");
    expect(
      (
        await api(
          "/api/v1/auth/password-reset",
          jsonInit("POST", { token, password: TEST_PASSWORD }),
        )
      ).status,
    ).toBe(204);
    expect((await finish(t1, codes[0] ?? "")).status).toBe(401);
    // The reset link set a password only: MFA is still on.
    expect(await hasMfa(env.DB, m.userId)).toBe(true);

    const t2 = await pendingTicket("m@example.test");
    const fresh = await createUserWithSession({ kind: "cli", email: "x@example.test" });
    await env.DB.prepare("UPDATE sessions SET user_id = ? WHERE user_id = ?")
      .bind(m.userId, fresh.userId)
      .run();
    expect(
      (
        await api(
          "/api/v1/auth/password",
          jsonInit(
            "POST",
            { currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD },
            { token: fresh.token },
          ),
        )
      ).status,
    ).toBe(204);
    expect((await finish(t2, codes[1] ?? "")).status).toBe(401);

    const t3 = await pendingTicket("m@example.test");
    expect((await reset(owner.token, m.userId)).status).toBe(204);
    expect((await finish(t3, codes[2] ?? "")).status).toBe(401);
  });
});

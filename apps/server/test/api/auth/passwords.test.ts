import { env } from "cloudflare:workers";
import type { ApiErrorBody, InstanceRole } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  api,
  auditRows,
  createServiceToken,
  createUserWithSession,
  json,
  jsonInit,
  resetDb,
  TEST_PASSWORD,
} from "#test/support";

const NEW_PASSWORD = "a brand new passphrase";
const INVALID_LINK = "Link is invalid or has expired";
const bearer = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
const me = (t: string) => api("/api/v1/auth/me", bearer(t));
const login = (email: string, password = TEST_PASSWORD) =>
  api("/api/v1/auth/login", jsonInit("POST", { email, password, client: "cli" }));
const loginToken = async (email: string, password = TEST_PASSWORD) => {
  const res = await login(email, password);
  expect(res.status).toBe(200);
  return (await json<{ token: string }>(res)).token;
};
const changePassword = (t: string, currentPassword: string, newPassword = NEW_PASSWORD) =>
  api("/api/v1/auth/password", jsonInit("POST", { currentPassword, newPassword }, { token: t }));
const createReset = (t: string, userId: string) =>
  api(`/api/v1/users/${userId}/password-reset`, jsonInit("POST", undefined, { token: t }));
const useReset = (token: string, password = NEW_PASSWORD) =>
  api("/api/v1/auth/password-reset", jsonInit("POST", { token, password }));
const user = (role: InstanceRole, email: string) =>
  createUserWithSession({ role, kind: "cli", email });

async function resetLink(by: string, userId: string): Promise<string> {
  const res = await createReset(by, userId);
  expect(res.status).toBe(201);
  const { url } = await json<{ url: string; expiresAt: number }>(res);
  return new URL(url).hash.replace("#token=", "");
}

let owner: { userId: string; token: string };
beforeEach(async () => {
  await resetDb();
  owner = await user("owner", "owner@example.test");
});

describe("change password", () => {
  it("change password with the correct current password revokes other sessions but keeps this one", async () => {
    const m = await user("member", "m@example.test");
    const other = await loginToken("m@example.test");
    const res = await changePassword(m.token, TEST_PASSWORD);
    expect(res.status).toBe(204);
    expect((await me(m.token)).status).toBe(200);
    expect((await me(other)).status).toBe(401);
    expect((await login("m@example.test")).status).toBe(401);
    expect((await login("m@example.test", NEW_PASSWORD)).status).toBe(200);
    const [audit] = await auditRows("auth.password_changed");
    expect(audit).toMatchObject({ actor_id: m.userId, target: m.userId });
    expect(JSON.stringify(audit)).not.toContain(NEW_PASSWORD);
  });

  it("change password with the wrong current password -> 401 and counts toward lockout", async () => {
    const m = await user("member", "m@example.test");
    for (let i = 0; i < 5; i++) {
      const res = await changePassword(m.token, "wrong password!!");
      expect(res.status).toBe(401);
      expect((await json<ApiErrorBody>(res)).error.code).toBe("invalid_credentials");
    }
    expect((await changePassword(m.token, TEST_PASSWORD)).status).toBe(429);
    expect((await login("m@example.test")).status).toBe(429);
    expect((await me(m.token)).status).toBe(200);
  });

  it("a correct current password resets the failure count", async () => {
    const m = await user("member", "m@example.test");
    for (let i = 0; i < 4; i++) await changePassword(m.token, "wrong password!!");
    expect((await changePassword(m.token, TEST_PASSWORD)).status).toBe(204);
    const row = await env.DB.prepare("SELECT failed_logins FROM users WHERE id = ?")
      .bind(m.userId)
      .first<{ failed_logins: number }>();
    expect(row?.failed_logins).toBe(0);
  });

  it("new password policy enforced -> 400", async () => {
    const m = await user("member", "m@example.test");
    expect((await changePassword(m.token, TEST_PASSWORD, "short")).status).toBe(400);
    expect((await login("m@example.test")).status).toBe(200);
  });

  it("service token on /auth/password -> 403", async () => {
    await api(
      "/api/v1/projects",
      jsonInit("POST", { name: "App", slug: "app" }, { token: owner.token }),
    );
    const { token } = await createServiceToken("app", {
      permission: "read",
      scopes: [{ environment: "dev", path: "/" }],
    });
    expect((await changePassword(token, TEST_PASSWORD)).status).toBe(403);
    expect(
      (
        await api(
          "/api/v1/auth/password",
          jsonInit("POST", { currentPassword: "x", newPassword: NEW_PASSWORD }),
        )
      ).status,
    ).toBe(401);
  });
});

describe("password reset links", () => {
  it("url has token in fragment", async () => {
    const m = await user("member", "m@example.test");
    const res = await createReset(owner.token, m.userId);
    expect(res.status).toBe(201);
    const body = await json<{ url: string; expiresAt: number }>(res);
    expect(body.url).toMatch(
      /^http:\/\/anchor\.test\/reset-password#token=anc_rst_[A-Za-z0-9_-]{43}$/,
    );
    expect(body.expiresAt - Date.now()).toBeGreaterThan(3_500_000);
    expect(body.expiresAt - Date.now()).toBeLessThanOrEqual(3_600_000);
    const token = new URL(body.url).hash.replace("#token=", "");
    const row = await env.DB.prepare("SELECT * FROM password_resets").first();
    expect(JSON.stringify(row)).not.toContain(token);
    const [audit] = await auditRows("password_reset.created");
    expect(JSON.parse(audit?.metadata ?? "{}")).toEqual({ userId: m.userId });
    expect(audit?.metadata).not.toContain(token);
  });

  it("reset link: owner creates for member; member resets; old password fails; all old sessions 401", async () => {
    const m = await user("member", "m@example.test");
    const second = await loginToken("m@example.test");
    const token = await resetLink(owner.token, m.userId);
    expect((await useReset(token)).status).toBe(204);
    expect((await me(m.token)).status).toBe(401);
    expect((await me(second)).status).toBe(401);
    expect((await login("m@example.test")).status).toBe(401);
    expect((await login("m@example.test", NEW_PASSWORD)).status).toBe(200);
    const [audit] = await auditRows("auth.password_reset");
    expect(audit).toMatchObject({
      actor_type: "user",
      actor_id: m.userId,
      actor_label: "m@example.test",
    });
  });

  it("reset link reused -> 404", async () => {
    const m = await user("member", "m@example.test");
    const token = await resetLink(owner.token, m.userId);
    expect((await useReset(token)).status).toBe(204);
    const again = await useReset(token, "yet another passphrase");
    expect(again.status).toBe(404);
    expect((await json<ApiErrorBody>(again)).error).toEqual({
      code: "not_found",
      message: INVALID_LINK,
    });
    expect((await login("m@example.test", NEW_PASSWORD)).status).toBe(200);
  });

  it("two parallel resets -> exactly one 204", async () => {
    const m = await user("member", "m@example.test");
    const token = await resetLink(owner.token, m.userId);
    const results = await Promise.all([
      useReset(token, "first parallel pass"),
      useReset(token, "second parallel pass"),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 404]);
    const winner = results[0]?.status === 204 ? "first parallel pass" : "second parallel pass";
    expect((await login("m@example.test", winner)).status).toBe(200);
  });

  it("expired reset link -> 404", async () => {
    const m = await user("member", "m@example.test");
    const token = await resetLink(owner.token, m.userId);
    await env.DB.prepare("UPDATE password_resets SET expires_at = ?")
      .bind(Date.now() - 1)
      .run();
    expect((await useReset(token)).status).toBe(404);
    expect((await login("m@example.test")).status).toBe(200);
  });

  it("creating a new reset invalidates the previous link", async () => {
    const m = await user("member", "m@example.test");
    const first = await resetLink(owner.token, m.userId);
    const second = await resetLink(owner.token, m.userId);
    expect((await useReset(first)).status).toBe(404);
    expect((await useReset(second)).status).toBe(204);
  });

  it("reset for a disabled user -> 409 on create; a link created before disabling -> 404 on use", async () => {
    const m = await user("member", "m@example.test");
    const token = await resetLink(owner.token, m.userId);
    expect(
      (
        await api(
          `/api/v1/users/${m.userId}`,
          jsonInit("PATCH", { disabled: true }, { token: owner.token }),
        )
      ).status,
    ).toBe(200);
    const create = await createReset(owner.token, m.userId);
    expect(create.status).toBe(409);
    expect((await json<ApiErrorBody>(create)).error.message).toBe("User is disabled");
    expect((await useReset(token)).status).toBe(404);
    const row = await env.DB.prepare("SELECT used_at FROM password_resets").first<{
      used_at: number | null;
    }>();
    expect(row?.used_at).toBeNull();
  });

  it("admin cannot create a reset for an owner or another admin -> 403", async () => {
    const admin = await user("admin", "admin@example.test");
    const admin2 = await user("admin", "admin2@example.test");
    const m = await user("member", "m@example.test");
    expect((await createReset(admin.token, owner.userId)).status).toBe(403);
    expect((await createReset(admin.token, admin2.userId)).status).toBe(403);
    expect((await createReset(admin.token, m.userId)).status).toBe(201);
    expect((await createReset(owner.token, admin.userId)).status).toBe(201);
    expect((await createReset(m.token, admin.userId)).status).toBe(403);
  });

  it("a reset link stops working when its target is promoted beyond the creator's authority", async () => {
    const admin = await user("admin", "admin@example.test");
    const m = await user("member", "m@example.test");
    const token = await resetLink(admin.token, m.userId);
    const promote = await api(
      `/api/v1/users/${m.userId}`,
      jsonInit("PATCH", { role: "owner" }, { token: owner.token }),
    );
    expect(promote.status).toBe(200);
    expect((await useReset(token)).status).toBe(404);
    expect((await login("m@example.test")).status).toBe(200);
  });

  it("a reset link dies with its creator's authority", async () => {
    const admin = await user("admin", "admin@example.test");
    const m1 = await user("member", "m1@example.test");
    const m2 = await user("member", "m2@example.test");
    const disabledCreator = await resetLink(admin.token, m1.userId);
    const admin2 = await user("admin", "admin2@example.test");
    const demotedCreator = await resetLink(admin2.token, m2.userId);
    await api(
      `/api/v1/users/${admin.userId}`,
      jsonInit("PATCH", { disabled: true }, { token: owner.token }),
    );
    await api(
      `/api/v1/users/${admin2.userId}`,
      jsonInit("PATCH", { role: "member" }, { token: owner.token }),
    );
    expect((await useReset(disabledCreator)).status).toBe(404);
    expect((await useReset(demotedCreator)).status).toBe(404);
    // An owner's link for an admin keeps working.
    const admin3 = await user("admin", "admin3@example.test");
    expect((await useReset(await resetLink(owner.token, admin3.userId))).status).toBe(204);
  });

  it("self reset -> 409; unknown user -> 404", async () => {
    const self = await createReset(owner.token, owner.userId);
    expect(self.status).toBe(409);
    expect((await json<ApiErrorBody>(self)).error.message).toBe("Use change password instead");
    expect((await createReset(owner.token, "nope")).status).toBe(404);
  });

  it("reset clears lockout", async () => {
    const m = await user("member", "m@example.test");
    for (let i = 0; i < 5; i++)
      expect((await login("m@example.test", "wrong password!!")).status).toBe(401);
    expect((await login("m@example.test")).status).toBe(429);
    const token = await resetLink(owner.token, m.userId);
    expect((await useReset(token)).status).toBe(204);
    expect((await login("m@example.test", NEW_PASSWORD)).status).toBe(200);
  });

  it("invalid tokens and weak passwords", async () => {
    const m = await user("member", "m@example.test");
    const token = await resetLink(owner.token, m.userId);
    expect((await useReset(token, "short")).status).toBe(400);
    expect((await useReset("anc_rst_bogus")).status).toBe(404);
    expect((await useReset("garbage")).status).toBe(404);
    expect((await useReset(token)).status).toBe(204);
  });
});

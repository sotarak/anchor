import { env } from "cloudflare:workers";
import type { ApiErrorBody, InstanceRole, UserDto } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  api,
  auditRows,
  createMember,
  createServiceToken,
  createUserWithSession,
  json,
  jsonInit,
  resetDb,
  TEST_PASSWORD,
} from "#test/support";

const bearer = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
const usersUrl = (id = "") => `/api/v1/users${id ? `/${id}` : ""}`;
const patchUser = (t: string, id: string, body: unknown) =>
  api(usersUrl(id), jsonInit("PATCH", body, { token: t }));
const deleteUser = (t: string, id: string) =>
  api(usersUrl(id), jsonInit("DELETE", undefined, { token: t }));
const login = (email: string, password = TEST_PASSWORD) =>
  api("/api/v1/auth/login", jsonInit("POST", { email, password, client: "cli" }));
const me = (init: RequestInit) => api("/api/v1/auth/me", init);
const user = (role: InstanceRole, email?: string) =>
  createUserWithSession({ role, kind: "cli", ...(email ? { email } : {}) });
const LAST_OWNER = "An instance must keep at least one active owner";

async function errorOf(res: Response, status: number): Promise<ApiErrorBody["error"]> {
  expect(res.status).toBe(status);
  return (await json<ApiErrorBody>(res)).error;
}

beforeEach(async () => {
  await resetDb();
});

describe("instance users", () => {
  it("admin lists users; member gets 403", async () => {
    const owner = await user("owner", "owner@example.test");
    const admin = await user("admin", "admin@example.test");
    const member = await user("member", "member@example.test");
    const res = await api(usersUrl(), bearer(admin.token));
    expect(res.status).toBe(200);
    const { users } = await json<{ users: UserDto[] }>(res);
    expect(users.map((u) => [u.email, u.role, u.disabledAt])).toEqual([
      ["admin@example.test", "admin", null],
      ["member@example.test", "member", null],
      ["owner@example.test", "owner", null],
    ]);
    expect(JSON.stringify(users)).not.toMatch(/password|hash/i);
    expect((await api(usersUrl(), bearer(member.token))).status).toBe(403);
    expect((await patchUser(member.token, owner.userId, { role: "member" })).status).toBe(403);
    expect((await deleteUser(member.token, admin.userId)).status).toBe(403);
  });

  it("service tokens cannot manage users", async () => {
    const owner = await user("owner");
    await api(
      "/api/v1/projects",
      jsonInit("POST", { name: "App", slug: "app" }, { token: owner.token }),
    );
    const { token } = await createServiceToken("app", {
      permission: "read",
      scopes: [{ environment: "dev", path: "/" }],
    });
    expect((await errorOf(await api(usersUrl(), bearer(token)), 403)).message).toBe(
      "This endpoint requires a user session",
    );
  });

  it("unknown user -> 404", async () => {
    const owner = await user("owner");
    expect((await patchUser(owner.token, "nope", { role: "member" })).status).toBe(404);
    expect((await deleteUser(owner.token, "nope")).status).toBe(404);
  });

  it("admin promotes member to admin; admin cannot promote anyone to owner -> 403", async () => {
    await user("owner");
    const admin = await user("admin");
    const member = await user("member");
    const res = await patchUser(admin.token, member.userId, { role: "admin" });
    expect(res.status).toBe(200);
    expect((await json<{ user: UserDto }>(res)).user).toMatchObject({
      id: member.userId,
      role: "admin",
      disabledAt: null,
    });
    expect((await patchUser(admin.token, member.userId, { role: "owner" })).status).toBe(403);
    expect((await patchUser(admin.token, admin.userId, { role: "owner" })).status).toBe(403);
    const row = await env.DB.prepare("SELECT role FROM users WHERE id = ?")
      .bind(member.userId)
      .first<{ role: string }>();
    expect(row?.role).toBe("admin");
  });

  it("admin cannot demote, disable or delete an owner -> 403", async () => {
    const owner = await user("owner");
    const admin = await user("admin");
    expect((await patchUser(admin.token, owner.userId, { role: "member" })).status).toBe(403);
    expect((await patchUser(admin.token, owner.userId, { disabled: true })).status).toBe(403);
    expect((await deleteUser(admin.token, owner.userId)).status).toBe(403);
    expect((await me(bearer(owner.token))).status).toBe(200);
  });

  it("owner can promote admin to owner", async () => {
    const owner = await user("owner");
    const admin = await user("admin");
    const res = await patchUser(owner.token, admin.userId, { role: "owner" });
    expect(res.status).toBe(200);
    expect((await json<{ user: UserDto }>(res)).user.role).toBe("owner");
  });

  it("last active owner cannot demote themselves -> 409; with two owners, one demotion succeeds", async () => {
    const a = await user("owner");
    const b = await user("owner");
    expect((await patchUser(a.token, b.userId, { role: "admin" })).status).toBe(200);
    expect(
      (await errorOf(await patchUser(a.token, a.userId, { role: "admin" }), 409)).message,
    ).toBe(LAST_OWNER);
    const row = await env.DB.prepare("SELECT role FROM users WHERE id = ?")
      .bind(a.userId)
      .first<{ role: string }>();
    expect(row?.role).toBe("owner");
  });

  it("disabled second owner does not count as active owner", async () => {
    const a = await user("owner");
    const b = await user("owner");
    expect((await patchUser(a.token, b.userId, { disabled: true })).status).toBe(200);
    expect(
      (await errorOf(await patchUser(a.token, a.userId, { role: "member" }), 409)).message,
    ).toBe(LAST_OWNER);
    // Re-enabling the second owner makes the demotion possible again.
    expect((await patchUser(a.token, b.userId, { disabled: false })).status).toBe(200);
    expect((await patchUser(a.token, a.userId, { role: "member" })).status).toBe(200);
  });

  it("disabling a user revokes their sessions immediately", async () => {
    const owner = await user("owner");
    const target = await createUserWithSession({ role: "member", kind: "web" });
    const cli = await login(
      (
        await env.DB.prepare("SELECT email FROM users WHERE id = ?")
          .bind(target.userId)
          .first<{ email: string }>()
      )?.email ?? "",
    );
    const { token: cliToken } = await json<{ token: string }>(cli);
    expect((await me(bearer(cliToken))).status).toBe(200);
    expect((await me({ headers: { cookie: target.cookie } })).status).toBe(200);

    const res = await patchUser(owner.token, target.userId, { disabled: true });
    expect(res.status).toBe(200);
    expect((await json<{ user: UserDto }>(res)).user.disabledAt).toEqual(expect.any(Number));
    expect((await me(bearer(cliToken))).status).toBe(401);
    expect((await me({ headers: { cookie: target.cookie } })).status).toBe(401);
    const n = await env.DB.prepare("SELECT count(*) AS n FROM sessions WHERE user_id = ?")
      .bind(target.userId)
      .first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("a session of a disabled user is rejected even when it was not revoked", async () => {
    const target = await user("member");
    await env.DB.prepare("UPDATE users SET disabled_at = ? WHERE id = ?")
      .bind(Date.now(), target.userId)
      .run();
    expect((await me(bearer(target.token))).status).toBe(401);
  });

  it("disabled user login with correct password -> 403, wrong password -> 401", async () => {
    const owner = await user("owner");
    const target = await user("member", "target@example.test");
    await patchUser(owner.token, target.userId, { disabled: true });
    expect(await errorOf(await login("target@example.test"), 403)).toEqual({
      code: "forbidden",
      message: "Account disabled",
    });
    expect((await errorOf(await login("target@example.test", "wrong password!"), 401)).code).toBe(
      "invalid_credentials",
    );
    const n = await env.DB.prepare("SELECT count(*) AS n FROM sessions WHERE user_id = ?")
      .bind(target.userId)
      .first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("re-enabling restores login", async () => {
    const owner = await user("owner");
    const target = await user("member", "target@example.test");
    await patchUser(owner.token, target.userId, { disabled: true });
    const res = await patchUser(owner.token, target.userId, { disabled: false });
    expect((await json<{ user: UserDto }>(res)).user.disabledAt).toBeNull();
    const ok = await login("target@example.test");
    expect(ok.status).toBe(200);
    expect((await me(bearer((await json<{ token: string }>(ok)).token))).status).toBe(200);
  });

  it("cannot disable or delete yourself -> 409", async () => {
    await user("owner");
    const admin = await user("admin");
    expect(
      (await errorOf(await patchUser(admin.token, admin.userId, { disabled: true }), 409)).message,
    ).toBe("You cannot disable yourself");
    expect((await errorOf(await deleteUser(admin.token, admin.userId), 409)).message).toBe(
      "You cannot delete yourself",
    );
    expect((await me(bearer(admin.token))).status).toBe(200);
  });

  it("deleting a user removes memberships and sessions", async () => {
    const owner = await user("owner");
    await api(
      "/api/v1/projects",
      jsonInit("POST", { name: "App", slug: "app" }, { token: owner.token }),
    );
    const member = await createMember("app", { role: "developer" });
    expect((await deleteUser(owner.token, member.userId)).status).toBe(204);
    for (const table of ["users", "sessions", "project_members"]) {
      const n = await env.DB.prepare(
        `SELECT count(*) AS n FROM ${table} WHERE ${table === "users" ? "id" : "user_id"} = ?`,
      )
        .bind(member.userId)
        .first<{ n: number }>();
      expect(n?.n, table).toBe(0);
    }
    expect((await me(bearer(member.token))).status).toBe(401);
    expect((await deleteUser(owner.token, member.userId)).status).toBe(404);
  });

  it("owner deletes another owner; admin can delete a member", async () => {
    const a = await user("owner");
    const b = await user("owner");
    const admin = await user("admin");
    const member = await user("member");
    expect((await deleteUser(admin.token, member.userId)).status).toBe(204);
    expect((await deleteUser(a.token, b.userId)).status).toBe(204);
  });

  it("audit rows for user.updated and user.deleted carry no password fields", async () => {
    const owner = await user("owner");
    const target = await user("member", "target@example.test");
    await patchUser(owner.token, target.userId, { role: "admin" });
    await patchUser(owner.token, target.userId, { disabled: true });
    await deleteUser(owner.token, target.userId);
    const updated = await auditRows("user.updated");
    expect(updated.map((r) => JSON.parse(r.metadata))).toEqual([
      { userId: target.userId, role: "admin" },
      { userId: target.userId, disabled: true },
    ]);
    const deleted = await auditRows("user.deleted");
    expect(deleted.map((r) => JSON.parse(r.metadata))).toEqual([
      { userId: target.userId, email: "target@example.test" },
    ]);
    for (const r of [...updated, ...deleted]) {
      expect(r).toMatchObject({
        actor_type: "user",
        actor_id: owner.userId,
        target: target.userId,
      });
      expect(JSON.stringify(r)).not.toMatch(/password|hash/i);
    }
  });
});

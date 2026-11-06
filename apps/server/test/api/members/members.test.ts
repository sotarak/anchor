import { env } from "cloudflare:workers";
import type { ApiErrorBody, MemberDto, SecretDto } from "@anchor/shared";
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
} from "#test/support";

let owner: string;
const bearer = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
const membersUrl = (userId = "") => `/api/v1/projects/app/members${userId ? `/${userId}` : ""}`;
const secretUrl = (envSlug: string, key = "", query = "") =>
  `/api/v1/projects/app/environments/${envSlug}/secrets${key ? `/${key}` : ""}${query}`;

const addMember = (t: string, body: unknown) =>
  api(membersUrl(), jsonInit("POST", body, { token: t }));
const patchMember = (t: string, userId: string, body: unknown) =>
  api(membersUrl(userId), jsonInit("PATCH", body, { token: t }));
const removeMember = (t: string, userId: string) =>
  api(membersUrl(userId), jsonInit("DELETE", undefined, { token: t }));
const putSecret = (t: string, envSlug: string, key: string) =>
  api(secretUrl(envSlug, key), jsonInit("PUT", { value: "v", path: "/" }, { token: t }));

async function newUser(email: string) {
  return createUserWithSession({ role: "member", kind: "cli", email });
}

beforeEach(async () => {
  await resetDb();
  ({ token: owner } = await createUserWithSession({ role: "owner", kind: "cli" }));
  const res = await api(
    "/api/v1/projects",
    jsonInit("POST", { name: "App", slug: "app" }, { token: owner }),
  );
  expect(res.status).toBe(201);
});

describe("members", () => {
  it("project admin adds a developer restricted to dev; developer can write dev, gets 403 on prod", async () => {
    const admin = await createMember("app", { role: "admin" });
    const dev = await newUser("dev@example.test");
    const res = await addMember(admin.token, {
      email: "dev@example.test",
      role: "developer",
      environments: ["dev"],
    });
    expect(res.status).toBe(201);
    expect((await json<{ member: MemberDto }>(res)).member).toEqual({
      userId: dev.userId,
      email: "dev@example.test",
      name: "Test User",
      role: "developer",
      environments: ["dev"],
    });
    expect((await putSecret(dev.token, "dev", "K")).status).toBe(201);
    expect((await putSecret(dev.token, "prod", "K")).status).toBe(403);

    const list = await json<{ members: MemberDto[] }>(await api(membersUrl(), bearer(admin.token)));
    expect(list.members.map((m) => [m.userId, m.role, m.environments])).toEqual(
      expect.arrayContaining([
        [admin.userId, "admin", null],
        [dev.userId, "developer", ["dev"]],
      ]),
    );
    expect(list.members).toHaveLength(2);
  });

  it("viewer can list and read with reveal but cannot PUT", async () => {
    expect((await putSecret(owner, "dev", "K")).status).toBe(201);
    const viewer = await newUser("viewer@example.test");
    expect((await addMember(owner, { email: "viewer@example.test", role: "viewer" })).status).toBe(
      201,
    );
    const list = await api(secretUrl("dev"), bearer(viewer.token));
    expect(list.status).toBe(200);
    expect((await json<{ secrets: SecretDto[] }>(list)).secrets.map((s) => s.key)).toEqual(["K"]);
    const one = await api(secretUrl("dev", "K", "?reveal=true"), bearer(viewer.token));
    expect(one.status).toBe(200);
    expect((await json<{ secret: SecretDto }>(one)).secret.value).toBe("v");
    expect((await putSecret(viewer.token, "dev", "K")).status).toBe(403);
  });

  it("removing a member revokes access on the next request", async () => {
    const dev = await newUser("dev@example.test");
    await addMember(owner, { email: "dev@example.test", role: "developer" });
    expect((await api(secretUrl("dev"), bearer(dev.token))).status).toBe(200);
    expect((await removeMember(owner, dev.userId)).status).toBe(204);
    expect((await api(secretUrl("dev"), bearer(dev.token))).status).toBe(403);
    expect((await api("/api/v1/projects/app", bearer(dev.token))).status).toBe(403);
    const again = await removeMember(owner, dev.userId);
    expect(again.status).toBe(404);
    expect((await json<ApiErrorBody>(again)).error.message).toBe("Member not found");
  });

  it("adding the same user twice -> 409", async () => {
    await newUser("dev@example.test");
    await addMember(owner, { email: "dev@example.test", role: "developer" });
    const res = await addMember(owner, { email: "dev@example.test", role: "viewer" });
    expect(res.status).toBe(409);
    expect((await json<ApiErrorBody>(res)).error).toEqual({
      code: "conflict",
      message: "User is already a member",
    });
  });

  it("unknown email -> 404", async () => {
    const res = await addMember(owner, { email: "nobody@example.test", role: "developer" });
    expect(res.status).toBe(404);
    expect((await json<ApiErrorBody>(res)).error.message).toBe("User not found");
  });

  it("unknown env slug -> 404 and nothing is inserted", async () => {
    await newUser("dev@example.test");
    const res = await addMember(owner, {
      email: "dev@example.test",
      role: "developer",
      environments: ["dev", "qa"],
    });
    expect(res.status).toBe(404);
    expect((await json<ApiErrorBody>(res)).error.message).toBe("Environment not found");
    const n = await env.DB.prepare("SELECT count(*) AS n FROM project_members").first<{
      n: number;
    }>();
    expect(n?.n).toBe(0);
  });

  it("disabled user -> 409", async () => {
    const dev = await newUser("dev@example.test");
    await env.DB.prepare("UPDATE users SET disabled_at = ? WHERE id = ?")
      .bind(Date.now(), dev.userId)
      .run();
    const res = await addMember(owner, { email: "dev@example.test", role: "developer" });
    expect(res.status).toBe(409);
    expect((await json<ApiErrorBody>(res)).error.message).toBe("User is disabled");
  });

  it("admin role with environments -> 400 on both POST and PATCH", async () => {
    const dev = await newUser("dev@example.test");
    expect(
      (await addMember(owner, { email: "dev@example.test", role: "admin", environments: ["dev"] }))
        .status,
    ).toBe(400);
    await addMember(owner, { email: "dev@example.test", role: "developer", environments: ["dev"] });
    // Explicit in the body.
    expect(
      (await patchMember(owner, dev.userId, { role: "admin", environments: ["dev"] })).status,
    ).toBe(400);
    // Implicit: the stored restriction would survive a role-only change.
    const implicit = await patchMember(owner, dev.userId, { role: "admin" });
    expect(implicit.status).toBe(400);
    expect((await json<ApiErrorBody>(implicit)).error.code).toBe("bad_request");
    const ok = await patchMember(owner, dev.userId, { role: "admin", environments: null });
    expect(ok.status).toBe(200);
    expect((await json<{ member: MemberDto }>(ok)).member).toMatchObject({
      role: "admin",
      environments: null,
    });
  });

  it("PATCH changes environments; unknown member -> 404", async () => {
    const dev = await newUser("dev@example.test");
    await addMember(owner, { email: "dev@example.test", role: "developer" });
    const res = await patchMember(owner, dev.userId, { environments: ["prod"] });
    expect(res.status).toBe(200);
    expect((await json<{ member: MemberDto }>(res)).member).toMatchObject({
      role: "developer",
      environments: ["prod"],
    });
    expect((await putSecret(dev.token, "dev", "K")).status).toBe(403);
    expect((await putSecret(dev.token, "prod", "K")).status).toBe(201);
    const other = await newUser("other@example.test");
    expect((await patchMember(owner, other.userId, { role: "viewer" })).status).toBe(404);
  });

  it("developer cannot manage members -> 403", async () => {
    const dev = await createMember("app", { role: "developer" });
    await newUser("x@example.test");
    expect((await api(membersUrl(), bearer(dev.token))).status).toBe(403);
    expect((await addMember(dev.token, { email: "x@example.test", role: "viewer" })).status).toBe(
      403,
    );
    expect(
      (await patchMember(dev.token, dev.userId, { role: "admin", environments: null })).status,
    ).toBe(403);
    expect((await removeMember(dev.token, dev.userId)).status).toBe(403);
  });

  it("member of no project and service tokens cannot manage members", async () => {
    const outsider = await createUserWithSession({ role: "member", kind: "cli" });
    expect((await api(membersUrl(), bearer(outsider.token))).status).toBe(403);
    const { token } = await createServiceToken("app", {
      permission: "read-write",
      scopes: [{ environment: "dev", path: "/" }],
    });
    const res = await api(membersUrl(), bearer(token));
    expect(res.status).toBe(403);
    expect((await json<ApiErrorBody>(res)).error.message).toBe(
      "This endpoint requires a user session",
    );
  });

  it("deleting an environment drops it from member DTOs and access", async () => {
    const a = await newUser("a@example.test");
    const b = await newUser("b@example.test");
    await addMember(owner, {
      email: "a@example.test",
      role: "developer",
      environments: ["dev", "staging"],
    });
    await addMember(owner, {
      email: "b@example.test",
      role: "developer",
      environments: ["staging"],
    });
    expect(
      (
        await api(
          "/api/v1/projects/app/environments/staging",
          jsonInit("DELETE", undefined, { token: owner }),
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await api(
          "/api/v1/projects/app/environments",
          jsonInit("POST", { name: "Staging", slug: "staging" }, { token: owner }),
        )
      ).status,
    ).toBe(201);
    const { members } = await json<{ members: MemberDto[] }>(
      await api(membersUrl(), bearer(owner)),
    );
    const byId = new Map(members.map((m) => [m.userId, m.environments]));
    expect(byId.get(a.userId)).toEqual(["dev"]);
    // Losing every listed environment must never widen to "all environments" (null).
    expect(byId.get(b.userId)).toEqual([]);
    expect((await putSecret(b.token, "staging", "K")).status).toBe(403);
    expect((await putSecret(b.token, "dev", "K")).status).toBe(403);
    expect((await putSecret(a.token, "staging", "K")).status).toBe(403);
    expect((await putSecret(a.token, "dev", "K")).status).toBe(201);
  });

  it("audit rows for add/update/remove exist with actor = project admin", async () => {
    const admin = await createMember("app", { role: "admin" });
    const dev = await newUser("dev@example.test");
    await addMember(admin.token, {
      email: "dev@example.test",
      role: "developer",
      environments: ["dev"],
    });
    await patchMember(admin.token, dev.userId, { role: "viewer" });
    await removeMember(admin.token, dev.userId);
    const rows = [
      ...(await auditRows("member.added")),
      ...(await auditRows("member.updated")),
      ...(await auditRows("member.removed")),
    ];
    expect(rows.map((r) => r.action)).toEqual(["member.added", "member.updated", "member.removed"]);
    for (const r of rows) {
      expect(r).toMatchObject({ actor_type: "user", actor_id: admin.userId, target: dev.userId });
      expect(r.project_id).not.toBeNull();
    }
    expect(rows.map((r) => JSON.parse(r.metadata))).toEqual([
      { userId: dev.userId, role: "developer", environments: ["dev"] },
      { userId: dev.userId, role: "viewer", environments: ["dev"] },
      { userId: dev.userId, role: "viewer", environments: ["dev"] },
    ]);
  });
});

import { env } from "cloudflare:workers";
import type { ApiErrorBody, InviteDto, LoginResponse } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "#src/auth/sessions";
import { api, auditRows, createUserWithSession, json, jsonInit, resetDb } from "#test/support";

const NEW_PASSWORD = "a brand new passphrase";
const INVALID_LINK = "Link is invalid or has expired";
let owner: { userId: string; token: string };

const bearer = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
const invite = (t: string, body: unknown) =>
  api("/api/v1/invites", jsonInit("POST", body, { token: t }));
const inspect = (token: string) => api("/api/v1/invites/inspect", jsonInit("POST", { token }));
const accept = (token: string, password = NEW_PASSWORD) =>
  api("/api/v1/invites/accept", jsonInit("POST", { token, name: "New Person", password }));

async function invited(email = "new@example.test", role = "member", by = owner.token) {
  const res = await invite(by, { email, role });
  expect(res.status).toBe(201);
  const body = await json<{ invite: InviteDto; url: string }>(res);
  const token = new URL(body.url).hash.replace("#token=", "");
  return { ...body, token };
}

beforeEach(async () => {
  await resetDb();
  owner = await createUserWithSession({ role: "owner", kind: "cli" });
});

describe("invites", () => {
  it("create returns url with token in fragment", async () => {
    const { invite: dto, url, token } = await invited("new@example.test", "admin");
    expect(url).toMatch(/^http:\/\/anchor\.test\/accept-invite#token=anc_inv_[A-Za-z0-9_-]{43}$/);
    expect(dto).toMatchObject({
      email: "new@example.test",
      role: "admin",
      tokenPrefix: token.slice(0, 12),
      acceptedAt: null,
      revokedAt: null,
    });
    expect(dto.expiresAt - dto.createdAt).toBe(259_200_000);
    const list = await api("/api/v1/invites", bearer(owner.token));
    expect(list.status).toBe(200);
    const text = await list.text();
    expect(text).not.toContain(token.slice(12));
    expect((JSON.parse(text) as { invites: InviteDto[] }).invites.map((i) => i.id)).toEqual([
      dto.id,
    ]);
    const row = await env.DB.prepare("SELECT * FROM invites").first();
    expect(JSON.stringify(row)).not.toContain(token);
    const audit = await auditRows("invite.created");
    expect(audit.map((r) => JSON.parse(r.metadata))).toEqual([
      { email: "new@example.test", role: "admin" },
    ]);
  });

  it("inspect returns email and role", async () => {
    const { token } = await invited("new@example.test", "member");
    const res = await inspect(token);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ email: "new@example.test", role: "member" });
  });

  it("accept creates the user with the invited role and logs them in", async () => {
    const { token, invite: dto } = await invited("new@example.test", "admin");
    const res = await accept(token);
    expect(res.status).toBe(200);
    const body = await json<LoginResponse>(res);
    expect(body.user).toMatchObject({
      email: "new@example.test",
      name: "New Person",
      role: "admin",
    });
    expect(body.token).toBeUndefined();
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE}=anc_s_`);
    const session = cookie.split(";")[0] ?? "";
    const me = await api("/api/v1/auth/me", { headers: { cookie: session } });
    expect(me.status).toBe(200);
    const login = await api(
      "/api/v1/auth/login",
      jsonInit("POST", { email: "new@example.test", password: NEW_PASSWORD, client: "cli" }),
    );
    expect(login.status).toBe(200);
    const [audit] = await auditRows("invite.accepted");
    expect(audit).toMatchObject({
      actor_type: "user",
      actor_id: body.user.id,
      actor_label: "new@example.test",
      target: dto.id,
    });
    expect(audit?.metadata).not.toMatch(/password/i);
  });

  it("accepting twice -> second is 404", async () => {
    const { token } = await invited();
    expect((await accept(token)).status).toBe(200);
    const again = await accept(token);
    expect(again.status).toBe(404);
    expect((await json<ApiErrorBody>(again)).error).toEqual({
      code: "not_found",
      message: INVALID_LINK,
    });
    expect((await inspect(token)).status).toBe(404);
  });

  it("two parallel accepts -> exactly one 200, one 404, one user row", async () => {
    const { token } = await invited();
    const results = await Promise.all([accept(token), accept(token)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
    const n = await env.DB.prepare("SELECT count(*) AS n FROM users WHERE email = ?")
      .bind("new@example.test")
      .first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it("expired invite -> 404 on inspect and accept", async () => {
    const { token } = await invited();
    await env.DB.prepare("UPDATE invites SET expires_at = ?")
      .bind(Date.now() - 1)
      .run();
    expect((await inspect(token)).status).toBe(404);
    expect((await accept(token)).status).toBe(404);
    const n = await env.DB.prepare("SELECT count(*) AS n FROM users").first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it("revoked invite -> 404", async () => {
    const { token, invite: dto } = await invited();
    const res = await api(
      `/api/v1/invites/${dto.id}`,
      jsonInit("DELETE", undefined, { token: owner.token }),
    );
    expect(res.status).toBe(204);
    expect((await inspect(token)).status).toBe(404);
    expect((await accept(token)).status).toBe(404);
    expect((await auditRows("invite.revoked")).map((r) => r.target)).toEqual([dto.id]);
    const list = await json<{ invites: InviteDto[] }>(
      await api("/api/v1/invites", bearer(owner.token)),
    );
    expect(list.invites[0]?.revokedAt).toEqual(expect.any(Number));
    // A new invite for the same email is allowed once the old one is revoked.
    expect((await invite(owner.token, { email: "new@example.test", role: "member" })).status).toBe(
      201,
    );
    expect(
      (await api("/api/v1/invites/unknown", jsonInit("DELETE", undefined, { token: owner.token })))
        .status,
    ).toBe(404);
  });

  it("admin cannot invite an owner -> 403; owner can", async () => {
    const admin = await createUserWithSession({ role: "admin", kind: "cli" });
    expect((await invite(admin.token, { email: "o@example.test", role: "owner" })).status).toBe(
      403,
    );
    expect((await invite(admin.token, { email: "a@example.test", role: "admin" })).status).toBe(
      201,
    );
    const { token } = await invited("o@example.test", "owner");
    expect((await json<LoginResponse>(await accept(token))).user.role).toBe("owner");
  });

  it("a pending invite dies when its creator is disabled, demoted or deleted", async () => {
    const admins = await Promise.all(
      [1, 2, 3].map((i) =>
        createUserWithSession({ role: "admin", kind: "cli", email: `admin${i}@example.test` }),
      ),
    );
    const links = [];
    for (const [i, a] of admins.entries())
      links.push((await invited(`new${i}@example.test`, "admin", a.token)).token);
    const [a1, a2, a3] = admins;
    const opts = { token: owner.token };
    await api(`/api/v1/users/${a1?.userId}`, jsonInit("PATCH", { disabled: true }, opts));
    await api(`/api/v1/users/${a2?.userId}`, jsonInit("PATCH", { role: "member" }, opts));
    await api(`/api/v1/users/${a3?.userId}`, jsonInit("DELETE", undefined, opts));
    for (const link of links) {
      expect((await inspect(link)).status).toBe(404);
      expect((await accept(link)).status).toBe(404);
    }
    const n = await env.DB.prepare(
      "SELECT count(*) AS n FROM users WHERE email LIKE 'new%'",
    ).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("invite for an existing user's email -> 409", async () => {
    await createUserWithSession({ role: "member", email: "taken@example.test" });
    const res = await invite(owner.token, { email: "TAKEN@example.test", role: "member" });
    expect(res.status).toBe(409);
    expect((await json<ApiErrorBody>(res)).error.message).toBe("User already exists");
  });

  it("duplicate pending invite -> 409", async () => {
    await invited("new@example.test");
    const res = await invite(owner.token, { email: "new@example.test", role: "admin" });
    expect(res.status).toBe(409);
    expect((await json<ApiErrorBody>(res)).error.message).toBe(
      "A pending invite exists; revoke it first",
    );
  });

  it("an invite whose email was registered meanwhile cannot be accepted", async () => {
    const { token } = await invited("new@example.test");
    await createUserWithSession({ role: "member", email: "new@example.test" });
    expect((await accept(token)).status).toBe(404);
    const row = await env.DB.prepare("SELECT accepted_at FROM invites").first<{
      accepted_at: number | null;
    }>();
    expect(row?.accepted_at).toBeNull();
  });

  it("weak password on accept -> 400, invite still usable", async () => {
    const { token } = await invited();
    expect((await accept(token, "short")).status).toBe(400);
    expect((await inspect(token)).status).toBe(200);
    expect((await accept(token)).status).toBe(200);
  });

  it("member cannot create invites -> 403", async () => {
    const member = await createUserWithSession({ role: "member", kind: "cli" });
    expect((await invite(member.token, { email: "x@example.test", role: "member" })).status).toBe(
      403,
    );
    expect((await api("/api/v1/invites", bearer(member.token))).status).toBe(403);
    expect(
      (await api("/api/v1/invites", jsonInit("POST", { email: "x@example.test", role: "member" })))
        .status,
    ).toBe(401);
  });

  it("404 bodies for invalid, expired and used tokens are byte-identical", async () => {
    const used = await invited("used@example.test");
    expect((await accept(used.token)).status).toBe(200);
    const expired = await invited("expired@example.test");
    await env.DB.prepare("UPDATE invites SET expires_at = ? WHERE email = ?")
      .bind(Date.now() - 1, "expired@example.test")
      .run();
    const bodies = new Set<string>();
    for (const token of [used.token, expired.token, "anc_inv_bogus", "garbage"]) {
      for (const res of [await inspect(token), await accept(token)]) {
        expect(res.status).toBe(404);
        bodies.add(await res.text());
      }
    }
    expect(bodies.size).toBe(1);
  });
});

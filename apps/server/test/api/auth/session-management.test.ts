import { env } from "cloudflare:workers";
import type { SessionDto } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "#src/lib/random";
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

const bearer = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
const sessions = async (t: string) => {
  const res = await api("/api/v1/auth/sessions", bearer(t));
  expect(res.status).toBe(200);
  return (await json<{ sessions: SessionDto[] }>(res)).sessions;
};
const revoke = (t: string, id: string) =>
  api(`/api/v1/auth/sessions/${id}`, jsonInit("DELETE", undefined, { token: t }));
async function secondSession(email: string): Promise<string> {
  const res = await api(
    "/api/v1/auth/login",
    jsonInit("POST", { email, password: TEST_PASSWORD, client: "cli" }, {}),
  );
  return (await json<{ token: string }>(res)).token;
}

let a: { userId: string; token: string };
beforeEach(async () => {
  await resetDb();
  a = await createUserWithSession({ role: "member", kind: "cli", email: "a@example.test" });
});

describe("session management", () => {
  it("sessions list marks current; ids are 16 hex chars, not the stored hash", async () => {
    const other = await secondSession("a@example.test");
    // Make the factory session strictly older, so "newest first" is deterministic.
    await env.DB.prepare("UPDATE sessions SET created_at = created_at - 1000 WHERE id = ?")
      .bind(await sha256Hex(a.token))
      .run();
    const list = await sessions(a.token);
    expect(list).toHaveLength(2);
    expect(list.filter((s) => s.current)).toHaveLength(1);
    for (const s of list) {
      expect(s.id).toMatch(/^[0-9a-f]{16}$/);
      expect(s.kind).toBe("cli");
    }
    const stored = await env.DB.prepare("SELECT id FROM sessions WHERE user_id = ?")
      .bind(a.userId)
      .all<{ id: string }>();
    const text = JSON.stringify(list);
    for (const { id } of stored.results) expect(text).not.toContain(id);
    expect(text).not.toContain(a.token);
    expect(text).not.toContain(other);
    // Newest first: the login session was created after the factory one.
    expect(list[0]?.current).toBe(false);
    expect((await sessions(other))[0]?.current).toBe(true);
  });

  it("expired sessions are not listed", async () => {
    await secondSession("a@example.test");
    await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id != ?")
      .bind(Date.now() - 1, await sha256Hex(a.token))
      .run();
    expect(await sessions(a.token)).toHaveLength(1);
  });

  it("revoking another own session by short id -> that token 401", async () => {
    const other = await secondSession("a@example.test");
    const target = (await sessions(a.token)).find((s) => !s.current);
    expect(target).toBeDefined();
    expect((await revoke(a.token, target?.id ?? "")).status).toBe(204);
    expect((await api("/api/v1/auth/me", bearer(other))).status).toBe(401);
    expect((await api("/api/v1/auth/me", bearer(a.token))).status).toBe(200);
    expect((await revoke(a.token, target?.id ?? "")).status).toBe(404);
    const [audit] = await auditRows("session.revoked");
    expect(audit).toMatchObject({ actor_id: a.userId, target: target?.id });
  });

  it("cannot revoke another user's session -> 404", async () => {
    const b = await createUserWithSession({ role: "owner", kind: "cli" });
    const bSession = (await sessions(b.token))[0];
    const res = await revoke(a.token, bSession?.id ?? "");
    expect(res.status).toBe(404);
    expect((await api("/api/v1/auth/me", bearer(b.token))).status).toBe(200);
  });

  it("malformed id -> 400", async () => {
    for (const id of ["abc", "ZZZZZZZZZZZZZZZZ", "0123456789abcdef0", "0123456789ABCDEF"]) {
      expect((await revoke(a.token, id)).status, id).toBe(400);
    }
  });

  it("service token on /auth/sessions -> 403", async () => {
    const owner = await createUserWithSession({ role: "owner", kind: "cli" });
    await api(
      "/api/v1/projects",
      jsonInit("POST", { name: "App", slug: "app" }, { token: owner.token }),
    );
    const { token } = await createServiceToken("app", {
      permission: "read",
      scopes: [{ environment: "dev", path: "/" }],
    });
    expect((await api("/api/v1/auth/sessions", bearer(token))).status).toBe(403);
    expect((await revoke(token, "0123456789abcdef")).status).toBe(403);
  });
});

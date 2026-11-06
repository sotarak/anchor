import { env } from "cloudflare:workers";
import type { ApiErrorBody, UserDto } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "#src/lib/random";
import { api, createUserWithSession, json, jsonInit, resetDb } from "#test/support";

beforeEach(resetDb);

const me = (headers: Record<string, string>) => api("/api/v1/auth/me", { headers });

describe("GET /auth/me", () => {
  it("me returns the user for a valid cookie", async () => {
    const { userId, cookie } = await createUserWithSession({ email: "a@x.io", name: "Ann" });
    const res = await me({ cookie });
    expect(res.status).toBe(200);
    expect(await json<{ user: UserDto }>(res)).toEqual({
      user: { id: userId, email: "a@x.io", name: "Ann", role: "owner" },
    });
  });

  it("me returns the user for a valid bearer token", async () => {
    const { userId, token } = await createUserWithSession({ kind: "cli" });
    const res = await me({ authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect((await json<{ user: UserDto }>(res)).user.id).toBe(userId);
  });

  it("me is 401 with no credentials, an unknown token, a malformed header, and an expired session", async () => {
    const { token, cookie } = await createUserWithSession();
    await env.DB.prepare("UPDATE sessions SET expires_at = ?")
      .bind(Date.now() - 1)
      .run();
    const cases: Record<string, string>[] = [
      {},
      { authorization: "Bearer anc_s_unknownunknownunknownunknownunknownunknownx" },
      { authorization: "Bearer" },
      { authorization: `Basic ${token}` },
      { cookie: "__Host-anchor_session=garbage" },
      { cookie },
      { authorization: `Bearer ${token}` },
    ];
    for (const headers of cases) {
      const res = await me(headers);
      expect(res.status, JSON.stringify(headers)).toBe(401);
      expect(await json<ApiErrorBody>(res)).toEqual({
        error: { code: "unauthenticated", message: "Authentication required" },
      });
    }
  });
});

describe("POST /auth/logout", () => {
  it("logout revokes immediately (cookie)", async () => {
    const { cookie } = await createUserWithSession();
    const res = await api("/api/v1/auth/logout", jsonInit("POST", undefined, { cookie }));
    expect(res.status).toBe(204);
    expect((await me({ cookie })).status).toBe(401);
  });

  it("logout revokes immediately (bearer)", async () => {
    const { token } = await createUserWithSession({ kind: "cli" });
    const res = await api("/api/v1/auth/logout", jsonInit("POST", undefined, { token }));
    expect(res.status).toBe(204);
    expect((await me({ authorization: `Bearer ${token}` })).status).toBe(401);
  });

  it("logout response clears the cookie", async () => {
    const { cookie } = await createUserWithSession();
    const res = await api("/api/v1/auth/logout", jsonInit("POST", undefined, { cookie }));
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("__Host-anchor_session=;");
    expect(setCookie).toContain("Max-Age=0");
  });

  it("logout without a session still returns 204", async () => {
    const res = await api("/api/v1/auth/logout", jsonInit("POST", undefined));
    expect(res.status).toBe(204);
  });
});

describe("CSRF origin check", () => {
  it("cookie POST without Origin -> 403", async () => {
    const { cookie } = await createUserWithSession();
    const res = await api(
      "/api/v1/auth/logout",
      jsonInit("POST", undefined, { cookie, origin: null }),
    );
    expect(res.status).toBe(403);
    expect((await json<ApiErrorBody>(res)).error).toEqual({
      code: "forbidden",
      message: "Origin check failed",
    });
    expect((await me({ cookie })).status).toBe(200);
  });

  it("cookie POST with foreign Origin -> 403", async () => {
    const { cookie } = await createUserWithSession();
    const res = await api(
      "/api/v1/auth/logout",
      jsonInit("POST", undefined, { cookie, origin: "https://evil.example" }),
    );
    expect(res.status).toBe(403);
    expect((await me({ cookie })).status).toBe(200);
  });

  it("bearer POST without Origin -> allowed", async () => {
    const { token } = await createUserWithSession({ kind: "cli" });
    const res = await api("/api/v1/auth/logout", jsonInit("POST", undefined, { token }));
    expect(res.status).toBe(204);
  });
});

describe("session storage", () => {
  it("session row stores only the hash", async () => {
    const { token } = await createUserWithSession();
    const row = await env.DB.prepare("SELECT id FROM sessions").first<{ id: string }>();
    expect(row?.id).not.toBe(token);
    expect(row?.id).toBe(await sha256Hex(token));
  });
});

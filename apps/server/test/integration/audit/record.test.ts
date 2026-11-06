import { env } from "cloudflare:workers";
import type { AuditAction } from "@anchor/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "#src/app";
import { capKeys, recordAudit } from "#src/audit/record";
import { auditRows, createUserWithSession, jsonInit, resetDb, TEST_ORIGIN } from "#test/support";

const ROUTE = "/api/v1/__test/audit";

/** A test-only route that records one audit event with the metadata it is sent. */
function appWithAuditRoute() {
  const app = createApp();
  app.post(ROUTE, async (c) => {
    const { metadata } = (await c.req.json()) as { metadata?: Record<string, unknown> };
    await recordAudit(c, { action: "auth.login" satisfies AuditAction, metadata });
    return c.body(null, 204);
  });
  return app;
}

const send = (body: unknown, headers: Record<string, string> = {}) => {
  const init = jsonInit("POST", body);
  return appWithAuditRoute().request(
    TEST_ORIGIN + ROUTE,
    { ...init, headers: { ...(init.headers as Record<string, string>), ...headers } },
    env,
  );
};

beforeEach(resetDb);

describe("recordAudit", () => {
  it("records actor, request id, ip and user agent", async () => {
    const { userId, token } = await createUserWithSession({ email: "ann@example.test" });
    const res = await send(
      { metadata: { client: "web" } },
      {
        authorization: `Bearer ${token}`,
        "cf-ray": "ray-1",
        "cf-connecting-ip": "203.0.113.9",
        "user-agent": "t/1",
      },
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("x-request-id")).toBe("ray-1");
    const [row] = await auditRows("auth.login");
    expect(row).toMatchObject({
      actor_type: "user",
      actor_id: userId,
      actor_label: "ann@example.test",
      action: "auth.login",
      request_id: "ray-1",
      ip: "203.0.113.9",
      user_agent: "t/1",
      metadata: '{"client":"web"}',
    });
  });

  it("anonymous actor when no principal", async () => {
    const res = await send({});
    expect(res.status).toBe(204);
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const [row] = await auditRows();
    expect(row).toMatchObject({
      actor_type: "anonymous",
      actor_id: null,
      actor_label: null,
      ip: null,
      metadata: "{}",
    });
  });

  it("truncates the user agent to 512 chars", async () => {
    await send({}, { "user-agent": "u".repeat(600) });
    const [row] = await auditRows();
    expect(row?.user_agent).toHaveLength(512);
  });

  it("rejects forbidden metadata keys at any depth", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const metadata of [
        { value: "x" },
        { nested: { password: "x" } },
        { Token: "x" },
        { list: [{ rawValue: "x" }] },
      ]) {
        expect((await send({ metadata })).status, JSON.stringify(metadata)).toBe(500);
      }
    } finally {
      errors.mockRestore();
    }
    expect(await auditRows()).toEqual([]);
  });

  it("allows key names in metadata", async () => {
    expect((await send({ metadata: { path: "/", keys: ["DB_URL"] } })).status).toBe(204);
    const [row] = await auditRows();
    expect(JSON.parse(row?.metadata ?? "")).toEqual({ path: "/", keys: ["DB_URL"] });
  });

  it("capKeys also stops before the key names exceed the byte budget", () => {
    const keys = Array.from({ length: 500 }, (_, i) => `K${i}_${"X".repeat(250)}`);
    const capped = capKeys(keys);
    expect(capped.keysTruncated).toBe(true);
    expect(capped.keys).toEqual(keys.slice(0, capped.keys.length));
    expect(new TextEncoder().encode(JSON.stringify(capped)).byteLength).toBeLessThanOrEqual(12_288);
    const small = Array.from({ length: 10 }, (_, i) => `K${i}`);
    expect(capKeys(small)).toEqual({ keys: small });
  });

  it("capKeys truncates at 500", () => {
    const keys = Array.from({ length: 501 }, (_, i) => `K${i}`);
    const capped = capKeys(keys);
    expect(capped.keys).toHaveLength(500);
    expect(capped.keysTruncated).toBe(true);
    expect(capKeys(keys.slice(0, 500))).toEqual({ keys: keys.slice(0, 500) });
  });

  it("oversized metadata throws", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await send({ metadata: { blob: "x".repeat(16_400) } })).status).toBe(500);
    } finally {
      errors.mockRestore();
    }
    expect(await auditRows()).toEqual([]);
  });
});

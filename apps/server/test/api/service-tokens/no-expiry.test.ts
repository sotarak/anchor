import { env } from "cloudflare:workers";
import type { ServiceTokenDto } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { api, auditRows, createUserWithSession, json, jsonInit, resetDb } from "#test/support";

let owner: string;
const tokensUrl = "/api/v1/projects/app/service-tokens";
const secretsUrl = "/api/v1/projects/app/environments/prod/secrets?path=%2F";
const bearer = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });

async function create(expiresInDays: number | null) {
  const res = await api(
    tokensUrl,
    jsonInit(
      "POST",
      {
        name: "home-server",
        permission: "read",
        scopes: [{ environment: "prod", path: "/" }],
        expiresInDays,
      },
      { token: owner },
    ),
  );
  return res;
}

beforeEach(async () => {
  await resetDb();
  ({ token: owner } = await createUserWithSession({ role: "owner", kind: "cli" }));
  const res = await api(
    "/api/v1/projects",
    jsonInit("POST", { name: "app", slug: "app" }, { token: owner }),
  );
  expect(res.status).toBe(201);
});

describe("service tokens without an expiry", () => {
  it("create with null → 201, expiresAt null, token authenticates", async () => {
    const res = await create(null);
    expect(res.status).toBe(201);
    const body = await json<{ serviceToken: ServiceTokenDto; token: string }>(res);
    expect(body.serviceToken.expiresAt).toBeNull();
    const row = await env.DB.prepare("SELECT expires_at FROM service_tokens WHERE id = ?")
      .bind(body.serviceToken.id)
      .first();
    expect(row).toEqual({ expires_at: null });
    expect((await api(secretsUrl, bearer(body.token))).status).toBe(200);
  });

  it("the list shows expiresAt null", async () => {
    await create(null);
    const res = await api(tokensUrl, { headers: { authorization: `Bearer ${owner}` } });
    const { serviceTokens } = await json<{ serviceTokens: ServiceTokenDto[] }>(res);
    expect(serviceTokens.map((t) => t.expiresAt)).toEqual([null]);
  });

  it("audit metadata has expiresAt null", async () => {
    await create(null);
    const rows = await auditRows("service_token.created");
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]?.metadata ?? "{}")).toMatchObject({ expiresAt: null });
  });

  it("a revoked never-expiring token gets 401 immediately", async () => {
    const body = await json<{ serviceToken: ServiceTokenDto; token: string }>(await create(null));
    expect((await api(secretsUrl, bearer(body.token))).status).toBe(200);
    const del = await api(`${tokensUrl}/${body.serviceToken.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${owner}` },
    });
    expect(del.status).toBe(204);
    expect((await api(secretsUrl, bearer(body.token))).status).toBe(401);
  });

  it("a dated token past its expiry still gets 401", async () => {
    const body = await json<{ serviceToken: ServiceTokenDto; token: string }>(await create(1));
    await env.DB.prepare("UPDATE service_tokens SET expires_at = ? WHERE id = ?")
      .bind(Date.now() - 1, body.serviceToken.id)
      .run();
    expect((await api(secretsUrl, bearer(body.token))).status).toBe(401);
  });

  it("0.3.x body with a number still works", async () => {
    const res = await create(30);
    expect(res.status).toBe(201);
    const body = await json<{ serviceToken: ServiceTokenDto }>(res);
    expect(body.serviceToken.expiresAt).toBe(body.serviceToken.createdAt + 30 * 86_400_000);
  });

  it("an omitted expiresInDays is still a 400", async () => {
    const res = await api(
      tokensUrl,
      jsonInit(
        "POST",
        { name: "x", permission: "read", scopes: [{ environment: "prod", path: "/" }] },
        { token: owner },
      ),
    );
    expect(res.status).toBe(400);
  });
});

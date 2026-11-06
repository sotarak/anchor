import { env } from "cloudflare:workers";
import type { ApiErrorBody, SecretDto, ServiceTokenDto } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "#src/lib/random";
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
const tokensUrl = (project = "app") => `/api/v1/projects/${project}/service-tokens`;
const secretUrl = (envSlug: string, key = "", path = "/", project = "app") =>
  `/api/v1/projects/${project}/environments/${envSlug}/secrets${key ? `/${key}` : ""}?path=${encodeURIComponent(path)}`;

async function putSecret(envSlug: string, key: string, path: string, project = "app") {
  const res = await api(
    `/api/v1/projects/${project}/environments/${envSlug}/secrets/${key}`,
    jsonInit("PUT", { value: `${envSlug}${path}${key}`, path }, { token: owner }),
  );
  expect(res.status).toBe(201);
}

const scopedToProdApi = () =>
  createServiceToken("app", {
    permission: "read",
    scopes: [{ environment: "prod", path: "/api" }],
  });

beforeEach(async () => {
  await resetDb();
  ({ token: owner } = await createUserWithSession({ role: "owner", kind: "cli" }));
  for (const slug of ["app", "other"]) {
    const res = await api(
      "/api/v1/projects",
      jsonInit("POST", { name: slug, slug }, { token: owner }),
    );
    expect(res.status).toBe(201);
  }
  await putSecret("prod", "DB", "/api");
  await putSecret("prod", "DB", "/apix");
  await putSecret("prod", "ROOT", "/");
  await putSecret("staging", "DB", "/api");
  await putSecret("prod", "DB", "/api", "other");
});

describe("service tokens", () => {
  it("create returns the token once; list never includes it", async () => {
    const res = await api(
      tokensUrl(),
      jsonInit(
        "POST",
        {
          name: "deploy",
          permission: "read",
          scopes: [{ environment: "prod", path: "api/" }],
          expiresInDays: 7,
        },
        { token: owner },
      ),
    );
    expect(res.status).toBe(201);
    const created = await json<{ serviceToken: ServiceTokenDto; token: string }>(res);
    expect(created.token).toMatch(/^anc_st_[A-Za-z0-9_-]{43}$/);
    expect(created.serviceToken).toMatchObject({
      name: "deploy",
      tokenPrefix: created.token.slice(0, 12),
      projectSlug: "app",
      permission: "read",
      scopes: [{ environment: "prod", path: "/api" }],
      lastUsedAt: null,
      revokedAt: null,
    });
    expect(created.serviceToken.expiresAt - created.serviceToken.createdAt).toBe(7 * 86_400_000);

    const list = await api(tokensUrl(), bearer(owner));
    const text = await list.text();
    // The 12-char display prefix is listed; the secret remainder never is.
    expect(text).not.toContain(created.token.slice(12));
    const { serviceTokens } = JSON.parse(text) as { serviceTokens: ServiceTokenDto[] };
    expect(serviceTokens).toHaveLength(1);
    expect("token" in (serviceTokens[0] ?? {})).toBe(false);
  });

  it("stored row holds only the hash", async () => {
    const { token, id } = await scopedToProdApi();
    const row = await env.DB.prepare("SELECT * FROM service_tokens WHERE id = ?")
      .bind(id)
      .first<Record<string, unknown>>();
    expect(row?.token_hash).toBe(await sha256Hex(token));
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("token reads secrets in scope over HTTP", async () => {
    const { token } = await scopedToProdApi();
    const one = await api(secretUrl("prod", "DB", "/api"), bearer(token));
    expect(one.status).toBe(200);
    expect((await json<{ secret: SecretDto }>(one)).secret.value).toBe("prod/apiDB");
    const list = await api(`${secretUrl("prod", "", "/api")}&reveal=true`, bearer(token));
    expect(list.status).toBe(200);
    const projects = await json<{ projects: { slug: string }[] }>(
      await api("/api/v1/projects", bearer(token)),
    );
    expect(projects.projects.map((p) => p.slug)).toEqual(["app"]);
  });

  it("token is 403 on prod:/apix, prod:/ and staging:/api when scoped to prod:/api", async () => {
    const { token } = await scopedToProdApi();
    for (const url of [
      secretUrl("prod", "DB", "/apix"),
      secretUrl("prod", "ROOT", "/"),
      secretUrl("staging", "DB", "/api"),
      secretUrl("prod", "", "/"),
    ]) {
      const res = await api(url, bearer(token));
      expect(res.status, url).toBe(403);
      expect(await res.text()).not.toContain("prod/");
    }
  });

  it("token is 403 on another project and never sees its data", async () => {
    const { token } = await scopedToProdApi();
    for (const url of [
      secretUrl("prod", "DB", "/api", "other"),
      "/api/v1/projects/other",
      "/api/v1/projects/other/environments",
    ]) {
      const res = await api(url, bearer(token));
      expect(res.status, url).toBe(403);
    }
    expect((await api(secretUrl("prod", "DB", "/api", "missing"), bearer(token))).status).toBe(404);
  });

  it("environments listing for a token shows only scoped environments", async () => {
    const { token } = await scopedToProdApi();
    const res = await api("/api/v1/projects/app/environments", bearer(token));
    const { environments } = await json<{ environments: { slug: string }[] }>(res);
    expect(environments.map((e) => e.slug)).toEqual(["prod"]);
  });

  it("read-only token gets 403 on PUT and DELETE; read-write token can write in scope only", async () => {
    const ro = await scopedToProdApi();
    const put = (t: string, path: string) =>
      api(
        "/api/v1/projects/app/environments/prod/secrets/NEW",
        jsonInit("PUT", { value: "v", path }, { token: t }),
      );
    expect((await put(ro.token, "/api")).status).toBe(403);
    expect(
      (await api(secretUrl("prod", "DB", "/api"), { ...bearer(ro.token), method: "DELETE" }))
        .status,
    ).toBe(403);
    const rw = await createServiceToken("app", {
      permission: "read-write",
      scopes: [{ environment: "prod", path: "/api" }],
    });
    expect((await put(rw.token, "/api")).status).toBe(201);
    expect((await put(rw.token, "/apix")).status).toBe(403);
  });

  it("revoked token is 401 on the very next request", async () => {
    const { token, id } = await scopedToProdApi();
    expect((await api(secretUrl("prod", "DB", "/api"), bearer(token))).status).toBe(200);
    const del = await api(`${tokensUrl()}/${id}`, jsonInit("DELETE", undefined, { token: owner }));
    expect(del.status).toBe(204);
    expect((await api(secretUrl("prod", "DB", "/api"), bearer(token))).status).toBe(401);
    const again = await api(
      `${tokensUrl()}/${id}`,
      jsonInit("DELETE", undefined, { token: owner }),
    );
    expect(again.status).toBe(204);
    const { serviceTokens } = await json<{ serviceTokens: ServiceTokenDto[] }>(
      await api(tokensUrl(), bearer(owner)),
    );
    expect(serviceTokens[0]?.revokedAt).toEqual(expect.any(Number));
    expect(await auditRows("service_token.revoked")).toHaveLength(1);
  });

  it("revoking an unknown id or another project's token -> 404", async () => {
    const other = await createServiceToken("other", {
      permission: "read",
      scopes: [{ environment: "prod", path: "/" }],
    });
    for (const id of ["nope", other.id]) {
      const res = await api(
        `${tokensUrl()}/${id}`,
        jsonInit("DELETE", undefined, { token: owner }),
      );
      expect(res.status, id).toBe(404);
    }
  });

  it("expired token is 401", async () => {
    const { token, id } = await scopedToProdApi();
    await env.DB.prepare("UPDATE service_tokens SET expires_at = ? WHERE id = ?")
      .bind(Date.now() - 1, id)
      .run();
    expect((await api(secretUrl("prod", "DB", "/api"), bearer(token))).status).toBe(401);
  });

  it("recreated environment with the same slug does not inherit scope", async () => {
    const { token } = await scopedToProdApi();
    const envUrl = "/api/v1/projects/app/environments";
    expect(
      (await api(`${envUrl}/prod`, jsonInit("DELETE", undefined, { token: owner }))).status,
    ).toBe(204);
    expect(
      (await api(envUrl, jsonInit("POST", { name: "Prod", slug: "prod" }, { token: owner })))
        .status,
    ).toBe(201);
    await putSecret("prod", "DB", "/api");
    expect((await api(secretUrl("prod", "DB", "/api"), bearer(token))).status).toBe(403);
    const { serviceTokens } = await json<{ serviceTokens: ServiceTokenDto[] }>(
      await api(tokensUrl(), bearer(owner)),
    );
    expect(serviceTokens[0]?.scopes).toEqual([]);
  });

  it("token cannot call user-only endpoints", async () => {
    const { token } = await createServiceToken("app", {
      permission: "read-write",
      scopes: [{ environment: "prod", path: "/" }],
    });
    const res = await api(tokensUrl(), bearer(token));
    expect(res.status).toBe(403);
    expect((await json<ApiErrorBody>(res)).error.message).toBe(
      "This endpoint requires a user session",
    );
    expect(
      (await api("/api/v1/projects", jsonInit("POST", { name: "x", slug: "x" }, { token }))).status,
    ).toBe(403);
  });

  it("token cannot create tokens or manage environments", async () => {
    const { token } = await createServiceToken("app", {
      permission: "read-write",
      scopes: [{ environment: "prod", path: "/" }],
    });
    const body = {
      name: "x",
      permission: "read",
      scopes: [{ environment: "prod", path: "/" }],
      expiresInDays: 1,
    };
    expect((await api(tokensUrl(), jsonInit("POST", body, { token }))).status).toBe(403);
    expect(
      (
        await api(
          "/api/v1/projects/app/environments",
          jsonInit("POST", { name: "QA", slug: "qa" }, { token }),
        )
      ).status,
    ).toBe(403);
  });

  it("/auth/me returns serviceToken DTO", async () => {
    const { token, id } = await scopedToProdApi();
    const res = await api("/api/v1/auth/me", bearer(token));
    expect(res.status).toBe(200);
    const body = await json<{ serviceToken: ServiceTokenDto; user?: unknown }>(res);
    expect(body.user).toBeUndefined();
    expect(body.serviceToken).toMatchObject({
      id,
      projectSlug: "app",
      scopes: [{ environment: "prod", path: "/api" }],
    });
  });

  it("last_used_at is throttled", async () => {
    const { token, id } = await scopedToProdApi();
    const lastUsed = async () =>
      (
        await env.DB.prepare("SELECT last_used_at FROM service_tokens WHERE id = ?")
          .bind(id)
          .first<{ last_used_at: number | null }>()
      )?.last_used_at;
    expect(await lastUsed()).toBeNull();
    await api(secretUrl("prod", "DB", "/api"), bearer(token));
    expect(await lastUsed()).toEqual(expect.any(Number));

    const recent = Date.now() - 30_000;
    await env.DB.prepare("UPDATE service_tokens SET last_used_at = ? WHERE id = ?")
      .bind(recent, id)
      .run();
    await api(secretUrl("prod", "DB", "/api"), bearer(token));
    await api(secretUrl("prod", "DB", "/api"), bearer(token));
    expect(await lastUsed()).toBe(recent);

    const stale = Date.now() - 61_000;
    await env.DB.prepare("UPDATE service_tokens SET last_used_at = ? WHERE id = ?")
      .bind(stale, id)
      .run();
    await api(secretUrl("prod", "DB", "/api"), bearer(token));
    expect(await lastUsed()).toBeGreaterThan(stale);
  });

  it("developer member cannot create tokens; project admin can", async () => {
    const body = {
      name: "x",
      permission: "read",
      scopes: [{ environment: "dev", path: "/" }],
      expiresInDays: 1,
    };
    const dev = await createMember("app", { role: "developer" });
    const admin = await createMember("app", { role: "admin" });
    expect((await api(tokensUrl(), jsonInit("POST", body, { token: dev.token }))).status).toBe(403);
    expect((await api(tokensUrl(), jsonInit("POST", body, { token: admin.token }))).status).toBe(
      201,
    );
    const [row] = await auditRows("service_token.created");
    expect(JSON.parse(row?.metadata ?? "{}")).toEqual({
      name: "x",
      permission: "read",
      scopes: [{ environment: "dev", path: "/" }],
    });
  });

  it("expiresInDays 366 -> 400; unknown environment -> 404", async () => {
    const body = {
      name: "x",
      permission: "read",
      scopes: [{ environment: "prod", path: "/" }],
      expiresInDays: 366,
    };
    expect((await api(tokensUrl(), jsonInit("POST", body, { token: owner }))).status).toBe(400);
    const unknown = { ...body, expiresInDays: 1, scopes: [{ environment: "nope", path: "/" }] };
    const res = await api(tokensUrl(), jsonInit("POST", unknown, { token: owner }));
    expect(res.status).toBe(404);
    expect((await json<ApiErrorBody>(res)).error.message).toBe("Environment not found");
  });

  it("a service token in a cookie is not a credential", async () => {
    const { token } = await scopedToProdApi();
    const res = await api(secretUrl("prod", "DB", "/api"), {
      headers: { cookie: `__Host-anchor_session=${token}` },
    });
    expect(res.status).toBe(401);
  });
});

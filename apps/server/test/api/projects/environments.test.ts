import { env } from "cloudflare:workers";
import type { ApiErrorBody, EnvironmentDto } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { api, createMember, createUserWithSession, json, jsonInit, resetDb } from "#test/support";

let token: string;
const base = (project = "app") => `/api/v1/projects/${project}/environments`;
const list = async (project = "app") =>
  (
    await json<{ environments: EnvironmentDto[] }>(
      await api(base(project), { headers: { authorization: `Bearer ${token}` } }),
    )
  ).environments;

beforeEach(async () => {
  await resetDb();
  ({ token } = await createUserWithSession({ kind: "cli" }));
  for (const slug of ["app", "other"]) {
    await api("/api/v1/projects", jsonInit("POST", { name: slug, slug }, { token }));
  }
});

describe("environments", () => {
  it("lists default envs in order dev, staging, prod", async () => {
    expect((await list()).map((e) => e.slug)).toEqual(["dev", "staging", "prod"]);
  });

  it("creates qa at position 3", async () => {
    const res = await api(base(), jsonInit("POST", { name: "QA", slug: "qa" }, { token }));
    expect(res.status).toBe(201);
    expect((await json<{ environment: EnvironmentDto }>(res)).environment).toMatchObject({
      slug: "qa",
      name: "QA",
      position: 3,
    });
    expect((await list()).map((e) => e.slug)).toEqual(["dev", "staging", "prod", "qa"]);
  });

  it("duplicate slug -> 409", async () => {
    const res = await api(base(), jsonInit("POST", { name: "Dev 2", slug: "dev" }, { token }));
    expect(res.status).toBe(409);
  });

  it("invalid slug -> 400", async () => {
    const res = await api(base(), jsonInit("POST", { name: "Bad", slug: "Bad Slug" }, { token }));
    expect(res.status).toBe(400);
  });

  it("rename keeps slug", async () => {
    const res = await api(
      `${base()}/dev`,
      jsonInit("PATCH", { name: "Local", slug: "zzz" }, { token }),
    );
    expect(res.status).toBe(200);
    expect((await json<{ environment: EnvironmentDto }>(res)).environment).toMatchObject({
      slug: "dev",
      name: "Local",
    });
  });

  it("delete removes the env and its secrets", async () => {
    const dev = (await list()).find((e) => e.slug === "dev");
    await env.DB.prepare(
      "INSERT INTO secrets (id, project_id, environment_id, path, key, current_version, created_at, updated_at) SELECT 's1', project_id, id, '/', 'K', 1, 0, 0 FROM environments WHERE id = ?",
    )
      .bind(dev?.id)
      .run();
    const res = await api(`${base()}/dev`, jsonInit("DELETE", undefined, { token }));
    expect(res.status).toBe(204);
    expect((await list()).map((e) => e.slug)).toEqual(["staging", "prod"]);
    const n = await env.DB.prepare("SELECT count(*) AS n FROM secrets").first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("deleting the last env -> 409", async () => {
    await api(`${base()}/dev`, jsonInit("DELETE", undefined, { token }));
    await api(`${base()}/staging`, jsonInit("DELETE", undefined, { token }));
    const res = await api(`${base()}/prod`, jsonInit("DELETE", undefined, { token }));
    expect(res.status).toBe(409);
    expect((await json<ApiErrorBody>(res)).error).toEqual({
      code: "conflict",
      message: "A project must keep at least one environment",
    });
    expect((await list()).map((e) => e.slug)).toEqual(["prod"]);
  });

  it("env of another project is not reachable", async () => {
    await api(base("other"), jsonInit("POST", { name: "QA", slug: "qa" }, { token }));
    const res = await api(`${base("app")}/qa`, jsonInit("PATCH", { name: "x" }, { token }));
    expect(res.status).toBe(404);
    expect((await json<ApiErrorBody>(res)).error.message).toBe("Environment not found");
    expect((await api(`${base("app")}/qa`, jsonInit("DELETE", undefined, { token }))).status).toBe(
      404,
    );
  });

  it("member without membership -> 403", async () => {
    const member = await createUserWithSession({ kind: "cli", role: "member" });
    const auth = { token: member.token };
    expect(
      (await api(base(), { headers: { authorization: `Bearer ${member.token}` } })).status,
    ).toBe(403);
    expect((await api(base(), jsonInit("POST", { name: "QA", slug: "qa" }, auth))).status).toBe(
      403,
    );
    expect((await api(`${base()}/dev`, jsonInit("DELETE", undefined, auth))).status).toBe(403);
  });

  it("member with env restriction sees only allowed environments", async () => {
    const member = await createMember("app", { role: "developer", environments: ["dev", "prod"] });
    const res = await api(base(), { headers: { authorization: `Bearer ${member.token}` } });
    expect(res.status).toBe(200);
    const { environments } = await json<{ environments: EnvironmentDto[] }>(res);
    expect(environments.map((e) => e.slug)).toEqual(["dev", "prod"]);
  });

  it("only a project admin member can manage environments", async () => {
    const dev = await createMember("app", { role: "developer" });
    const admin = await createMember("app", { role: "admin" });
    const add = (t: string, slug: string) =>
      api(base(), jsonInit("POST", { name: slug, slug }, { token: t }));
    expect((await add(dev.token, "qa")).status).toBe(403);
    expect((await add(admin.token, "qa")).status).toBe(201);
  });
});

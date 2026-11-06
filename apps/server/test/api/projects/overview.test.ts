import type { OverviewDto, ProjectDto } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  api,
  createMember,
  createServiceToken,
  createUserWithSession,
  json,
  jsonInit,
  resetDb,
} from "#test/support";

let owner: string;
const bearer = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
const put = (envSlug: string, key: string, value = "v", path = "/") =>
  api(
    `/api/v1/projects/app/environments/${envSlug}/secrets/${key}`,
    jsonInit("PUT", { value, path }, { token: owner }),
  );
const overview = (token: string, query = "") =>
  api(`/api/v1/projects/app/overview${query}`, bearer(token));

beforeEach(async () => {
  await resetDb();
  ({ token: owner } = await createUserWithSession({ role: "owner", kind: "cli" }));
  const res = await api(
    "/api/v1/projects",
    jsonInit("POST", { name: "App", slug: "app" }, { token: owner }),
  );
  expect(res.status).toBe(201);
});

describe("GET /projects/:project/overview", () => {
  it("overview lists keys across envs with null for missing", async () => {
    for (const [envSlug, key] of [
      ["dev", "A"],
      ["prod", "A"],
      ["staging", "B"],
    ] as const) {
      expect((await put(envSlug, key)).status).toBe(201);
    }
    await put("prod", "A", "v2");
    const res = await overview(owner);
    expect(res.status).toBe(200);
    const body = await json<OverviewDto>(res);
    expect(body.environments.map((e) => e.slug)).toEqual(["dev", "staging", "prod"]);
    expect(body.keys.map((k) => k.key)).toEqual(["A", "B"]);
    const [a, b] = body.keys;
    expect(a?.cells.staging).toBeNull();
    expect(a?.cells.dev).toMatchObject({ version: 1, updatedAt: expect.any(Number) });
    expect(a?.cells.prod).toMatchObject({ version: 2 });
    expect(b?.cells.dev).toBeNull();
    expect(b?.cells.prod).toBeNull();
    expect(b?.cells.staging).toMatchObject({ version: 1 });
  });

  it("overview never contains values", async () => {
    await put("dev", "CANARY", "OVERVIEW-CANARY");
    const res = await overview(owner);
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("OVERVIEW-CANARY");
  });

  it("overview respects path", async () => {
    await put("dev", "ROOT");
    await put("dev", "NESTED", "v", "/api");
    const root = await json<OverviewDto>(await overview(owner, "?path=%2F"));
    expect(root.keys.map((k) => k.key)).toEqual(["ROOT"]);
    const nested = await json<OverviewDto>(await overview(owner, "?path=api"));
    expect(nested.keys.map((k) => k.key)).toEqual(["NESTED"]);
    expect((await overview(owner, "?path=..%2Fx")).status).toBe(400);
  });

  it("developer restricted to dev sees only the dev column", async () => {
    await put("dev", "A");
    await put("prod", "B");
    const dev = await createMember("app", { role: "developer", environments: ["dev"] });
    const body = await json<OverviewDto>(await overview(dev.token));
    expect(body.environments.map((e) => e.slug)).toEqual(["dev"]);
    expect(body.keys.map((k) => k.key)).toEqual(["A"]);
    expect(Object.keys(body.keys[0]?.cells ?? {})).toEqual(["dev"]);
  });

  it("non-member gets 403, unauthenticated gets 401, unknown project gets 404", async () => {
    const stranger = await createUserWithSession({ role: "member", kind: "cli" });
    expect((await overview(stranger.token)).status).toBe(403);
    expect((await api("/api/v1/projects/app/overview")).status).toBe(401);
    expect((await api("/api/v1/projects/nope/overview", bearer(owner))).status).toBe(404);
  });

  it("a service token sees only the environments its scopes cover at the requested path", async () => {
    await put("dev", "A", "v", "/api");
    await put("prod", "A", "v", "/api");
    await put("dev", "ROOT");
    const { token } = await createServiceToken("app", {
      permission: "read",
      scopes: [{ environment: "dev", path: "/api" }],
    });
    const nested = await json<OverviewDto>(await overview(token, "?path=%2Fapi"));
    expect(nested.environments.map((e) => e.slug)).toEqual(["dev"]);
    expect(nested.keys.map((k) => k.key)).toEqual(["A"]);
    expect(Object.keys(nested.keys[0]?.cells ?? {})).toEqual(["dev"]);
    // Outside its scoped path the token reads nothing, not even key names.
    const root = await overview(token, "?path=%2F");
    expect(root.status).toBe(200);
    expect(await json<OverviewDto>(root)).toEqual({ environments: [], keys: [] });
  });

  it("a service token for another project gets 403", async () => {
    await put("dev", "A");
    const other = await api(
      "/api/v1/projects",
      jsonInit("POST", { name: "Other", slug: "other" }, { token: owner }),
    );
    expect(other.status).toBe(201);
    const { token } = await createServiceToken("other", {
      permission: "read-write",
      scopes: [{ environment: "dev", path: "/" }],
    });
    const res = await overview(token);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('"A"');
  });

  it("GET /projects/:project omits access for a service token", async () => {
    const { token } = await createServiceToken("app", {
      permission: "read",
      scopes: [{ environment: "dev", path: "/" }],
    });
    const res = await api("/api/v1/projects/app", bearer(token));
    expect(res.status).toBe(200);
    const { project } = await json<{ project: ProjectDto }>(res);
    expect(project.slug).toBe("app");
    expect("access" in project).toBe(false);
  });
});

describe("project access on project DTOs", () => {
  it("GET /projects/:project includes access", async () => {
    const own = await json<{ project: ProjectDto }>(
      await api("/api/v1/projects/app", bearer(owner)),
    );
    expect(own.project.access).toEqual({ role: "admin", environments: null });
    const viewer = await createMember("app", { role: "viewer", environments: ["staging"] });
    const v = await json<{ project: ProjectDto }>(
      await api("/api/v1/projects/app", bearer(viewer.token)),
    );
    expect(v.project.access).toEqual({ role: "viewer", environments: ["staging"] });
  });

  it("GET /projects lists access per project for members", async () => {
    await api(
      "/api/v1/projects",
      jsonInit("POST", { name: "Other", slug: "other" }, { token: owner }),
    );
    const dev = await createMember("app", { role: "developer" });
    const mine = await json<{ projects: ProjectDto[] }>(
      await api("/api/v1/projects", bearer(dev.token)),
    );
    expect(mine.projects.map((p) => [p.slug, p.access])).toEqual([
      ["app", { role: "developer", environments: null }],
    ]);
    const all = await json<{ projects: ProjectDto[] }>(
      await api("/api/v1/projects", bearer(owner)),
    );
    expect(all.projects.map((p) => [p.slug, p.access])).toEqual([
      ["app", { role: "admin", environments: null }],
      ["other", { role: "admin", environments: null }],
    ]);
  });
});

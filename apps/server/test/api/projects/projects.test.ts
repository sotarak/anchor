import { env } from "cloudflare:workers";
import type { ApiErrorBody, EnvironmentDto, ProjectDto } from "@anchor/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "#src/app";
import { open, seal } from "#src/crypto/aead";
import { getRootKeyring } from "#src/crypto/keyring";
import { utf8Encode } from "#src/lib/encoding";
import { getProjectBySlug, getProjectKek } from "#src/projects/repo";
import {
  api,
  createMember,
  createUserWithSession,
  json,
  jsonInit,
  resetDb,
  TEST_ORIGIN,
} from "#test/support";

let token: string;
const bearer = () => ({ authorization: `Bearer ${token}` });
const create = (b: unknown, t = token) =>
  api("/api/v1/projects", jsonInit("POST", b, { token: t }));
const count = async (table: string) =>
  (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())?.n;

beforeEach(async () => {
  await resetDb();
  ({ token } = await createUserWithSession({ kind: "cli" }));
});

describe("projects", () => {
  it("create project provisions dev/staging/prod and KEK v1", async () => {
    const res = await create({ name: "My App", slug: "my-app" });
    expect(res.status).toBe(201);
    const { project } = await json<{ project: ProjectDto }>(res);
    expect(project).toMatchObject({ slug: "my-app", name: "My App" });
    const envs = await env.DB.prepare(
      "SELECT slug, name, position FROM environments WHERE project_id = ? ORDER BY position",
    )
      .bind(project.id)
      .all<Pick<EnvironmentDto, "slug" | "name" | "position">>();
    expect(envs.results).toEqual([
      { slug: "dev", name: "Development", position: 0 },
      { slug: "staging", name: "Staging", position: 1 },
      { slug: "prod", name: "Production", position: 2 },
    ]);
    const keys = await env.DB.prepare(
      "SELECT version, root_key_id FROM project_keys WHERE project_id = ?",
    )
      .bind(project.id)
      .all();
    expect(keys.results).toEqual([{ version: 1, root_key_id: env.ANCHOR_ROOT_KEY_ID }]);
  });

  it("KEK row never contains raw key material", async () => {
    await create({ name: "App", slug: "app" });
    const row = await env.DB.prepare("SELECT wrapped_key FROM project_keys").first<{
      wrapped_key: number[];
    }>();
    expect(row?.wrapped_key.length).toBe(48);
    const project = await getProjectBySlug(env.DB, "app");
    const kek = await getProjectKek(env.DB, await getRootKeyring(env), project);
    const sealed = await seal(kek, utf8Encode("x"), "aad");
    expect(await open(kek, sealed, "aad")).toEqual(utf8Encode("x"));
  });

  it("duplicate slug -> 409", async () => {
    await create({ name: "App", slug: "app" });
    const res = await create({ name: "Other", slug: "app" });
    expect(res.status).toBe(409);
    expect((await json<ApiErrorBody>(res)).error).toEqual({
      code: "conflict",
      message: "Project slug already exists",
    });
  });

  it('invalid slug "My App" -> 400', async () => {
    expect((await create({ name: "App", slug: "My App" })).status).toBe(400);
  });

  it("member without membership sees no projects and cannot create", async () => {
    await create({ name: "App", slug: "app" });
    const member = await createUserWithSession({ kind: "cli", role: "member" });
    expect((await create({ name: "Mine", slug: "mine" }, member.token)).status).toBe(403);
    const list = await api("/api/v1/projects", {
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(list.status).toBe(200);
    expect((await json<{ projects: ProjectDto[] }>(list)).projects).toEqual([]);
    const one = await api("/api/v1/projects/app", {
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(one.status).toBe(403);
  });

  it("member sees only their projects in GET /projects", async () => {
    for (const slug of ["alpha", "beta", "gamma"]) await create({ name: slug, slug });
    const member = await createMember("beta", { role: "viewer" });
    const res = await api("/api/v1/projects", {
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(res.status).toBe(200);
    const { projects } = await json<{ projects: ProjectDto[] }>(res);
    expect(projects.map((p) => p.slug)).toEqual(["beta"]);
  });

  it("viewer can read the project but not rename or delete it; project admin can rename only", async () => {
    await create({ name: "App", slug: "app" });
    const viewer = await createMember("app", { role: "viewer" });
    const admin = await createMember("app", { role: "admin" });
    const get = (t: string) =>
      api("/api/v1/projects/app", { headers: { authorization: `Bearer ${t}` } });
    const rename = (t: string) =>
      api("/api/v1/projects/app", jsonInit("PATCH", { name: "Renamed" }, { token: t }));
    const remove = (t: string) =>
      api("/api/v1/projects/app", jsonInit("DELETE", undefined, { token: t }));
    expect((await get(viewer.token)).status).toBe(200);
    expect((await rename(viewer.token)).status).toBe(403);
    expect((await rename(admin.token)).status).toBe(200);
    expect((await remove(admin.token)).status).toBe(403);
  });

  it("unauthenticated gets 401", async () => {
    expect((await api("/api/v1/projects")).status).toBe(401);
    expect((await api("/api/v1/projects", jsonInit("POST", { name: "a", slug: "a" }))).status).toBe(
      401,
    );
  });

  it("lists projects ordered by name and gets one by slug", async () => {
    await create({ name: "Zeta", slug: "zeta" });
    await create({ name: "Alpha", slug: "alpha" });
    const list = await json<{ projects: ProjectDto[] }>(
      await api("/api/v1/projects", { headers: bearer() }),
    );
    expect(list.projects.map((p) => p.slug)).toEqual(["alpha", "zeta"]);
    const one = await api("/api/v1/projects/zeta", { headers: bearer() });
    expect((await json<{ project: ProjectDto }>(one)).project.name).toBe("Zeta");
  });

  it("patch renames but cannot change slug", async () => {
    await create({ name: "App", slug: "app" });
    const res = await api(
      "/api/v1/projects/app",
      jsonInit("PATCH", { name: "Renamed", slug: "hacked" }, { token }),
    );
    expect(res.status).toBe(200);
    expect((await json<{ project: ProjectDto }>(res)).project).toMatchObject({
      slug: "app",
      name: "Renamed",
    });
    expect((await api("/api/v1/projects/hacked", { headers: bearer() })).status).toBe(404);
  });

  it("delete cascades environments, keys and secrets", async () => {
    const { project } = await json<{ project: ProjectDto }>(await create({ name: "A", slug: "a" }));
    const envRow = await env.DB.prepare("SELECT id FROM environments WHERE project_id = ? LIMIT 1")
      .bind(project.id)
      .first<{ id: string }>();
    await env.DB.prepare(
      "INSERT INTO secrets (id, project_id, environment_id, path, key, current_version, created_at, updated_at) VALUES ('s1', ?, ?, '/', 'K', 1, 0, 0)",
    )
      .bind(project.id, envRow?.id)
      .run();
    const res = await api("/api/v1/projects/a", jsonInit("DELETE", undefined, { token }));
    expect(res.status).toBe(204);
    for (const t of ["projects", "environments", "project_keys", "secrets"]) {
      expect(await count(t), t).toBe(0);
    }
  });

  it("unknown project -> 404", async () => {
    const res = await api("/api/v1/projects/nope", { headers: bearer() });
    expect(res.status).toBe(404);
    expect((await json<ApiErrorBody>(res)).error).toEqual({
      code: "not_found",
      message: "Project not found",
    });
  });

  it("create with malformed ANCHOR_ROOT_KEY -> 500 internal and nothing inserted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await createApp().request(
      `${TEST_ORIGIN}/api/v1/projects`,
      jsonInit("POST", { name: "App", slug: "app" }, { token }),
      { ...env, ANCHOR_ROOT_KEY: "short" },
    );
    expect(res.status).toBe(500);
    expect((await json<ApiErrorBody>(res)).error.code).toBe("internal");
    expect(await count("projects")).toBe(0);
    vi.restoreAllMocks();
  });
});

describe("root key mismatch", () => {
  it("creating a project under a different well-formed root key fails closed with config_error", async () => {
    expect((await create({ name: "First", slug: "first" })).status).toBe(201);
    const otherKey = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await createApp().request(
        `${TEST_ORIGIN}/api/v1/projects`,
        jsonInit("POST", { name: "Second", slug: "second" }, { token }),
        { ...env, ANCHOR_ROOT_KEY: otherKey },
      );
      expect(res.status).toBe(500);
      expect((await json<ApiErrorBody>(res)).error.code).toBe("internal");
      const logged = errors.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain("config_error");
      expect(logged).not.toContain(otherKey);
    } finally {
      errors.mockRestore();
    }
    expect(await count("projects")).toBe(1);
    expect(await count("project_keys")).toBe(1);
  });

  it("the first project can be created when no project keys exist yet", async () => {
    expect(await count("project_keys")).toBe(0);
    expect((await create({ name: "First", slug: "first" })).status).toBe(201);
  });
});

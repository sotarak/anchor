import { env } from "cloudflare:workers";
import type { FolderDto } from "@anchor/shared";
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

const ENV_BASE = "/api/v1/projects/app/environments/dev";
const FOLDERS = `${ENV_BASE}/folders`;
let token: string;

const bearer = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
const q = (path: string, extra = "") => `?path=${encodeURIComponent(path)}${extra}`;
const list = (path: string, t = token) => api(FOLDERS + q(path), bearer(t));
const create = (path: string, t = token) => api(FOLDERS, jsonInit("POST", { path }, { token: t }));
const remove = (path: string, force = false, t = token) =>
  api(FOLDERS + q(path, force ? "&force=true" : ""), { method: "DELETE", ...bearer(t) });
const putSecret = (path: string, key: string, value = "v") =>
  api(`${ENV_BASE}/secrets/${key}`, jsonInit("PUT", { value, path }, { token }));
const names = async (res: Response) =>
  (await json<{ folders: FolderDto[] }>(res)).folders.map((f) => f.name);

async function folderRows(): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT path FROM folders ORDER BY path").all<{
    path: string;
  }>();
  return results.map((r) => r.path);
}

async function secretPaths(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT path || ':' || key AS k FROM secrets ORDER BY path, key",
  ).all<{ k: string }>();
  return results.map((r) => r.k);
}

async function devEnvId(): Promise<{ projectId: string; environmentId: string }> {
  const row = await env.DB.prepare(
    "SELECT e.id AS environmentId, e.project_id AS projectId FROM environments e JOIN projects p ON p.id = e.project_id WHERE p.slug = 'app' AND e.slug = 'dev'",
  ).first<{ projectId: string; environmentId: string }>();
  if (!row) throw new Error("no dev env");
  return row;
}

beforeEach(async () => {
  await resetDb();
  ({ token } = await createUserWithSession({ role: "owner", kind: "cli" }));
  const res = await api(
    "/api/v1/projects",
    jsonInit("POST", { slug: "app", name: "App" }, { token }),
  );
  expect(res.status).toBe(201);
});

describe("folders API", () => {
  it("lists children from secrets written before M5 without folder rows", async () => {
    const { projectId, environmentId } = await devEnvId();
    await env.DB.prepare(
      "INSERT INTO secrets (id, project_id, environment_id, path, key, current_version, created_at, updated_at) VALUES ('s1', ?, ?, '/api/db', 'K', 1, 0, 0)",
    )
      .bind(projectId, environmentId)
      .run();
    const res = await list("/");
    expect(res.status).toBe(200);
    expect((await json<{ folders: FolderDto[] }>(res)).folders).toEqual([
      { path: "/api", name: "api" },
    ]);
    expect(await names(await list("/api"))).toEqual(["db"]);
    expect(await names(await list("/api/db"))).toEqual([]);
  });

  it("create makes all ancestors and is idempotent", async () => {
    const first = await create("/a/b/c");
    expect(first.status).toBe(201);
    expect((await json<{ folder: FolderDto }>(first)).folder).toEqual({
      path: "/a/b/c",
      name: "c",
    });
    expect(await folderRows()).toEqual(["/a", "/a/b", "/a/b/c"]);
    expect((await create("a/b/c/")).status).toBe(200);
    expect(await folderRows()).toEqual(["/a", "/a/b", "/a/b/c"]);
    expect(await names(await list("/a"))).toEqual(["b"]);
  });

  it("lists folder rows and secret paths together, de-duplicated and sorted", async () => {
    await create("/zeta");
    await putSecret("/alpha/x", "K");
    await putSecret("/zeta", "K");
    expect(await names(await list("/"))).toEqual(["alpha", "zeta"]);
  });

  it("putSecret at /x/y creates folder rows /x and /x/y", async () => {
    expect((await putSecret("/x/y", "K")).status).toBe(201);
    expect(await folderRows()).toEqual(["/x", "/x/y"]);
  });

  it("delete non-empty -> 409; force deletes subtree only", async () => {
    for (const path of ["/api", "/api/v1", "/apix", "/a_b", "/axb"]) {
      expect((await putSecret(path, "K")).status).toBe(201);
    }
    const blocked = await remove("/api");
    expect(blocked.status).toBe(409);
    expect((await json<{ error: { message: string } }>(blocked)).error.message).toBe(
      "Folder is not empty",
    );
    expect((await remove("/api", true)).status).toBe(204);
    expect((await remove("/a_b", true)).status).toBe(204);
    expect(await secretPaths()).toEqual(["/apix:K", "/axb:K"]);
    expect(await folderRows()).toEqual(["/apix", "/axb"]);
  });

  it("an empty folder deletes without force; an unknown one is 404", async () => {
    await create("/empty");
    expect((await remove("/empty")).status).toBe(204);
    expect(await folderRows()).toEqual([]);
    expect((await remove("/nope")).status).toBe(404);
  });

  it("imports targeting the subtree block deletion and force removes them", async () => {
    const { environmentId } = await devEnvId();
    await create("/imp");
    await env.DB.prepare(
      "INSERT INTO folder_imports (id, environment_id, path, source_environment_id, source_path, position, created_at) VALUES ('i1', ?, '/imp/sub', ?, '/shared', 1, 0)",
    )
      .bind(environmentId, environmentId)
      .run();
    expect((await remove("/imp")).status).toBe(409);
    expect((await remove("/imp", true)).status).toBe(204);
    const { results } = await env.DB.prepare("SELECT id FROM folder_imports").all();
    expect(results).toEqual([]);
  });

  it("paths are case-sensitive: /api never lists, blocks or force-deletes /API", async () => {
    await putSecret("/API/db", "PASSWORD", "upper-canary");
    await create("/api");
    expect(await names(await list("/api"))).toEqual([]);
    // Empty /api deletes without force although /API/db has content.
    expect((await remove("/api")).status).toBe(204);
    await putSecret("/api", "K");
    // A read-write token scoped to /api force-deletes /api only.
    const { token: st } = await createServiceToken("app", {
      permission: "read-write",
      scopes: [{ environment: "dev", path: "/api" }],
    });
    expect((await remove("/api", true, st)).status).toBe(204);
    expect(await secretPaths()).toEqual(["/API/db:PASSWORD"]);
    expect(await folderRows()).toEqual(["/API", "/API/db"]);
  });

  it("delete / -> 400, invalid path -> 400", async () => {
    expect((await remove("/", true)).status).toBe(400);
    expect((await create("/")).status).toBe(400);
    expect((await create("/a b")).status).toBe(400);
    expect((await list("/../x")).status).toBe(400);
  });

  it("service token scoped to /api: list ?path=/ -> 403, list ?path=/api -> 200", async () => {
    const { token: st } = await createServiceToken("app", {
      permission: "read",
      scopes: [{ environment: "dev", path: "/api" }],
    });
    expect((await list("/", st)).status).toBe(403);
    expect((await list("/api", st)).status).toBe(200);
  });

  it("viewer -> 403 on create/delete, 200 on list", async () => {
    await create("/x");
    const viewer = await createMember("app", { role: "viewer" });
    expect((await list("/", viewer.token)).status).toBe(200);
    expect((await create("/y", viewer.token)).status).toBe(403);
    expect((await remove("/x", false, viewer.token)).status).toBe(403);
    expect(await folderRows()).toEqual(["/x"]);
  });

  it("audit records folder.created and folder.deleted with counts and every deleted secret", async () => {
    await create("/c");
    await create("/c");
    await putSecret("/c/d", "K2");
    await putSecret("/c/d", "K1");
    await putSecret("/c", "TOP");
    expect((await remove("/c", true)).status).toBe(204);
    const created = await auditRows("folder.created");
    expect(created.map((r) => JSON.parse(r.metadata ?? "null"))).toEqual([{ path: "/c" }]);
    const [deleted] = await auditRows("folder.deleted");
    expect(JSON.parse(deleted?.metadata ?? "null")).toEqual({
      path: "/c",
      secretsDeleted: 3,
      foldersDeleted: 2,
      keys: ["/c/TOP", "/c/d/K1", "/c/d/K2"],
    });
  });

  it("folder.deleted caps a long list of deleted secrets and flags it", async () => {
    // ~60-byte entries: 260 of them pass the 10 KiB key-list budget.
    const key = (i: number) => `KEY_${String(i).padStart(3, "0")}_${"X".repeat(48)}`;
    for (let i = 0; i < 260; i++) await putSecret("/big", key(i));
    expect((await remove("/big", true)).status).toBe(204);
    const [deleted] = await auditRows("folder.deleted");
    const metadata = JSON.parse(deleted?.metadata ?? "null");
    expect(metadata.secretsDeleted).toBe(260);
    expect(metadata.keysTruncated).toBe(true);
    expect(metadata.keys.length).toBeGreaterThan(0);
    expect(metadata.keys.length).toBeLessThan(260);
    expect(metadata.keys[0]).toBe(`/big/${key(0)}`);
  }, 60_000);
});

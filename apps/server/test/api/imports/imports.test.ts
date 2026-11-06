import type { FolderImportDto } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  api,
  auditRows,
  createMember,
  createUserWithSession,
  json,
  jsonInit,
  resetDb,
} from "#test/support";

const IMPORTS = "/api/v1/projects/app/environments/dev/imports";
let token: string;

const bearer = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
const list = (path = "/", t = token) =>
  api(`${IMPORTS}?path=${encodeURIComponent(path)}`, bearer(t));
const create = (body: unknown, t = token) => api(IMPORTS, jsonInit("POST", body, { token: t }));
const remove = (id: string, t = token) =>
  api(`${IMPORTS}/${id}`, { method: "DELETE", ...bearer(t) });
const imports = async (res: Response) => (await json<{ imports: FolderImportDto[] }>(res)).imports;

beforeEach(async () => {
  await resetDb();
  ({ token } = await createUserWithSession({ role: "owner", kind: "cli" }));
  const res = await api(
    "/api/v1/projects",
    jsonInit("POST", { slug: "app", name: "App" }, { token }),
  );
  expect(res.status).toBe(201);
});

describe("folder imports API", () => {
  it("create, list ordered by position, delete", async () => {
    const first = await create({ path: "/api", source: { environment: "prod", path: "/shared" } });
    expect(first.status).toBe(201);
    const { import: created } = await json<{ import: FolderImportDto }>(first);
    expect(created).toMatchObject({
      path: "/api",
      source: { environment: "prod", path: "/shared" },
      position: 1,
    });
    expect(
      (await create({ path: "api/", source: { environment: "dev", path: "/common" } })).status,
    ).toBe(201);
    expect((await create({ source: { environment: "prod", path: "/" } })).status).toBe(201);

    const atApi = await imports(await list("/api"));
    expect(atApi.map((i) => [i.source.environment, i.source.path, i.position])).toEqual([
      ["prod", "/shared", 1],
      ["dev", "/common", 2],
    ]);
    expect((await imports(await list("/"))).map((i) => i.position)).toEqual([1]);

    expect((await remove(created.id)).status).toBe(204);
    expect((await imports(await list("/api"))).map((i) => i.source.path)).toEqual(["/common"]);
    expect((await remove(created.id)).status).toBe(404);
  });

  it("duplicate -> 409, self import -> 400, unknown source env -> 404, bad path -> 400", async () => {
    const body = { path: "/a", source: { environment: "prod", path: "/b" } };
    expect((await create(body)).status).toBe(201);
    expect((await create(body)).status).toBe(409);
    const self = await create({ path: "/a", source: { environment: "dev", path: "/a" } });
    expect(self.status).toBe(400);
    expect((await json<{ error: { message: string } }>(self)).error.message).toBe(
      "A folder cannot import itself",
    );
    expect((await create({ path: "/a", source: { environment: "nope", path: "/" } })).status).toBe(
      404,
    );
    expect(
      (await create({ path: "/a", source: { environment: "prod", path: "/../x" } })).status,
    ).toBe(400);
  });

  it("an import id from another environment -> 404", async () => {
    const res = await create({ path: "/", source: { environment: "prod", path: "/x" } });
    const { import: imp } = await json<{ import: FolderImportDto }>(res);
    const other = await api(`/api/v1/projects/app/environments/prod/imports/${imp.id}`, {
      method: "DELETE",
      ...bearer(token),
    });
    expect(other.status).toBe(404);
  });

  it("creating an import from an env the member cannot read -> 403", async () => {
    const dev = await createMember("app", { role: "developer", environments: ["dev"] });
    const res = await create({ path: "/", source: { environment: "prod", path: "/" } }, dev.token);
    expect(res.status).toBe(403);
    expect(await imports(await list("/"))).toEqual([]);
    expect(
      (await create({ path: "/", source: { environment: "dev", path: "/shared" } }, dev.token))
        .status,
    ).toBe(201);
  });

  it("viewer cannot create or delete (403) but can list", async () => {
    const res = await create({ path: "/", source: { environment: "prod", path: "/" } });
    const { import: imp } = await json<{ import: FolderImportDto }>(res);
    const viewer = await createMember("app", { role: "viewer" });
    expect((await list("/", viewer.token)).status).toBe(200);
    expect(
      (await create({ path: "/x", source: { environment: "prod", path: "/" } }, viewer.token))
        .status,
    ).toBe(403);
    expect((await remove(imp.id, viewer.token)).status).toBe(403);
  });

  it("deleting the source env removes the import", async () => {
    await create({ path: "/", source: { environment: "staging", path: "/" } });
    const del = await api("/api/v1/projects/app/environments/staging", {
      method: "DELETE",
      ...bearer(token),
    });
    expect(del.status).toBe(204);
    expect(await imports(await list("/"))).toEqual([]);
  });

  it("audit records import.created and import.deleted", async () => {
    const res = await create({ path: "/a", source: { environment: "prod", path: "/b" } });
    const { import: imp } = await json<{ import: FolderImportDto }>(res);
    await remove(imp.id);
    const meta = async (a: "import.created" | "import.deleted") =>
      (await auditRows(a)).map((r) => JSON.parse(r.metadata ?? "null"));
    const expected = [{ path: "/a", source: { environment: "prod", path: "/b" } }];
    expect(await meta("import.created")).toEqual(expected);
    expect(await meta("import.deleted")).toEqual(expected);
  });
});

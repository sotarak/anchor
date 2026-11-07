import type { SecretDto } from "@anchor/shared";
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

const url = (e = "dev") => `/api/v1/projects/app/environments/${e}/secrets`;
let owner: string;

const bearer = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
const put = (key: string, body: Record<string, unknown>, e = "dev") =>
  api(`${url(e)}/${key}`, jsonInit("PUT", body, { token: owner }));
const list = (query = "", t = owner, e = "dev") => api(`${url(e)}?${query}`, bearer(t));
const secrets = async (res: Response) => (await json<{ secrets: SecretDto[] }>(res)).secrets;
const byKey = (list: SecretDto[], key: string) => list.find((s) => s.key === key);

beforeEach(async () => {
  await resetDb();
  ({ token: owner } = await createUserWithSession({ role: "owner", kind: "cli" }));
  const res = await api(
    "/api/v1/projects",
    jsonInit("POST", { slug: "app", name: "App" }, { token: owner }),
  );
  expect(res.status).toBe(201);
});

describe("non-sensitive values", () => {
  it("list without reveal returns non-sensitive values only", async () => {
    await put("A", { value: "secret-a" });
    await put("B", { value: "30", type: "number", sensitive: false });
    const res = await list();
    expect(res.status).toBe(200);
    const body = await secrets(res);
    expect(byKey(body, "A")).not.toHaveProperty("value");
    expect(byKey(body, "B")).toMatchObject({ value: "30", type: "number", sensitive: false });
  });

  it("listing non-sensitive values records no secret.read", async () => {
    await put("B", { value: "30", type: "number", sensitive: false });
    expect((await list()).status).toBe(200);
    expect(await auditRows("secret.read")).toHaveLength(0);
    expect((await list("reveal=true")).status).toBe(200);
    expect(await auditRows("secret.read")).toHaveLength(1);
  });

  it("a non-sensitive value is never expanded without reveal", async () => {
    await put("PASS", { value: "s3cret" });
    await put("DSN", { value: "db://${PASS}", sensitive: false });
    const res = await list("expand=true");
    const text = await res.text();
    expect(text).not.toContain("s3cret");
    const dsn = byKey((JSON.parse(text) as { secrets: SecretDto[] }).secrets, "DSN");
    expect(dsn?.value).toBe("db://${PASS}");
    expect(dsn).not.toHaveProperty("rawValue");
  });

  it("non-sensitive values from an import", async () => {
    await put(
      "TIMEOUT",
      { value: "30", type: "number", sensitive: false, path: "/shared" },
      "prod",
    );
    const imp = await api(
      "/api/v1/projects/app/environments/dev/imports",
      jsonInit(
        "POST",
        { path: "/svc", source: { environment: "prod", path: "/shared" } },
        { token: owner },
      ),
    );
    expect(imp.status).toBe(201);
    const body = await secrets(await list("path=/svc&includeImports=true"));
    expect(byKey(body, "TIMEOUT")).toMatchObject({
      value: "30",
      importedFrom: { environment: "prod", path: "/shared" },
    });
    const devOnly = await createMember("app", { role: "developer", environments: ["dev"] });
    expect((await list("path=/svc&includeImports=true", devOnly.token)).status).toBe(403);
  });

  it("a member without access to the environment still gets 403", async () => {
    await put("B", { value: "30", sensitive: false }, "prod");
    const devOnly = await createMember("app", { role: "developer", environments: ["dev"] });
    expect((await list("", devOnly.token, "prod")).status).toBe(403);
  });
});

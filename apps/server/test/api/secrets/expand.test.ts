import type { SecretDto } from "@anchor/shared";
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

const secretsUrl = (e: string) => `/api/v1/projects/app/environments/${e}/secrets`;
let owner: string;

const bearer = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
const put = (e: string, path: string, key: string, value: string) =>
  api(`${secretsUrl(e)}/${key}`, jsonInit("PUT", { value, path }, { token: owner }));
const addImport = (e: string, path: string, source: { environment: string; path: string }) =>
  api(
    `/api/v1/projects/app/environments/${e}/imports`,
    jsonInit("POST", { path, source }, { token: owner }),
  );
const get = (e: string, key: string, query: string, t = owner) =>
  api(`${secretsUrl(e)}/${key}?${query}`, bearer(t));
const list = (e: string, query: string, t = owner) => api(`${secretsUrl(e)}?${query}`, bearer(t));
const secrets = async (res: Response) => (await json<{ secrets: SecretDto[] }>(res)).secrets;
const errorOf = async (res: Response) =>
  (await json<{ error: { code: string; message: string } }>(res)).error;

beforeEach(async () => {
  await resetDb();
  ({ token: owner } = await createUserWithSession({ role: "owner", kind: "cli" }));
  const res = await api(
    "/api/v1/projects",
    jsonInit("POST", { slug: "app", name: "App" }, { token: owner }),
  );
  expect(res.status).toBe(201);
});

describe("reference expansion", () => {
  it("expand=true returns expanded value and rawValue; without expand only raw value", async () => {
    await put("dev", "/db", "PASSWORD", "hunter2");
    await put("dev", "/db", "URL", "postgres://u:${PASSWORD}@h/db");
    await put("dev", "/db", "PLAIN", "no refs");

    const expanded = await get("dev", "URL", "path=/db&expand=true");
    expect(expanded.status).toBe(200);
    const { secret } = await json<{ secret: SecretDto }>(expanded);
    expect(secret.value).toBe("postgres://u:hunter2@h/db");
    expect(secret.rawValue).toBe("postgres://u:${PASSWORD}@h/db");

    const raw = await json<{ secret: SecretDto }>(await get("dev", "URL", "path=/db"));
    expect(raw.secret.value).toBe("postgres://u:${PASSWORD}@h/db");
    expect(raw.secret).not.toHaveProperty("rawValue");

    const plain = await json<{ secret: SecretDto }>(
      await get("dev", "PLAIN", "path=/db&expand=true"),
    );
    expect(plain.secret.value).toBe("no refs");
    expect(plain.secret).not.toHaveProperty("rawValue");

    const listed = await secrets(await list("dev", "path=/db&reveal=true&expand=true"));
    expect(listed.find((s) => s.key === "URL")).toMatchObject({
      value: "postgres://u:hunter2@h/db",
      rawValue: "postgres://u:${PASSWORD}@h/db",
    });
  });

  it("list without reveal ignores expand and returns no values", async () => {
    await put("dev", "/", "A", "${MISSING}");
    const res = await list("dev", "path=/&expand=true");
    expect(res.status).toBe(200);
    const [a] = await secrets(res);
    expect(a).not.toHaveProperty("value");
    expect(a).not.toHaveProperty("rawValue");
  });

  it("local key overrides import; earlier import wins over later", async () => {
    await put("dev", "/app", "LOCAL", "local");
    await put("prod", "/one", "LOCAL", "from-one");
    await put("prod", "/one", "SHARED", "from-one");
    await put("prod", "/two", "SHARED", "from-two");
    await put("prod", "/two", "ONLY_TWO", "two");
    expect((await addImport("dev", "/app", { environment: "prod", path: "/one" })).status).toBe(
      201,
    );
    expect((await addImport("dev", "/app", { environment: "prod", path: "/two" })).status).toBe(
      201,
    );

    const res = await list("dev", "path=/app&reveal=true&includeImports=true");
    expect(res.status).toBe(200);
    const byKey = Object.fromEntries((await secrets(res)).map((s) => [s.key, s]));
    expect(byKey.LOCAL).toMatchObject({ value: "local" });
    expect(byKey.LOCAL).not.toHaveProperty("importedFrom");
    expect(byKey.SHARED).toMatchObject({
      value: "from-one",
      importedFrom: { environment: "prod", path: "/one" },
    });
    expect(byKey.ONLY_TWO).toMatchObject({
      value: "two",
      importedFrom: { environment: "prod", path: "/two" },
    });

    const single = await get("dev", "ONLY_TWO", "path=/app&includeImports=true");
    expect(single.status).toBe(200);
    expect((await json<{ secret: SecretDto }>(single)).secret).toMatchObject({
      value: "two",
      importedFrom: { environment: "prod", path: "/two" },
    });
    expect((await get("dev", "ONLY_TWO", "path=/app")).status).toBe(404);

    const withoutImports = await secrets(await list("dev", "path=/app&reveal=true"));
    expect(withoutImports.map((s) => s.key)).toEqual(["LOCAL"]);
  });

  it("imports are not transitive", async () => {
    await put("dev", "/c", "FROM_C", "c");
    await put("dev", "/b", "FROM_B", "b");
    await addImport("dev", "/b", { environment: "dev", path: "/c" });
    await addImport("dev", "/a", { environment: "dev", path: "/b" });
    const keys = (await secrets(await list("dev", "path=/a&reveal=true&includeImports=true"))).map(
      (s) => s.key,
    );
    expect(keys).toEqual(["FROM_B"]);
  });

  it("imported value with ${KEY} resolves in the source folder, not the importing one", async () => {
    await put("prod", "/shared", "HOST", "prod-host");
    await put("prod", "/shared", "URL", "https://${HOST}/");
    await put("dev", "/app", "HOST", "dev-host");
    await addImport("dev", "/app", { environment: "prod", path: "/shared" });
    const listed = await secrets(
      await list("dev", "path=/app&reveal=true&includeImports=true&expand=true"),
    );
    expect(listed.find((s) => s.key === "URL")).toMatchObject({
      value: "https://prod-host/",
      rawValue: "https://${HOST}/",
      importedFrom: { environment: "prod", path: "/shared" },
    });
  });

  it("developer restricted to dev: ${prod:/DB_PASSWORD} -> 403 without the value or existence", async () => {
    await put("prod", "/", "DB_PASSWORD", "PROD-CANARY-31");
    await put("dev", "/", "USES_PROD", "x${prod:/DB_PASSWORD}");
    await put("dev", "/", "USES_GHOST", "x${prod:/GHOST}");
    const dev = await createMember("app", { role: "developer", environments: ["dev"] });

    const existing = await get("dev", "USES_PROD", "path=/&expand=true", dev.token);
    const ghost = await get("dev", "USES_GHOST", "path=/&expand=true", dev.token);
    expect([existing.status, ghost.status]).toEqual([403, 403]);
    const body = await existing.text();
    expect(body).not.toContain("PROD-CANARY-31");
    expect(body.toLowerCase()).not.toContain("not found");
    expect(body).toContain("${prod:/DB_PASSWORD}");
    expect((await errorOf(ghost)).code).toBe("forbidden");

    const listRes = await list("dev", "path=/&reveal=true&expand=true", dev.token);
    expect(listRes.status).toBe(403);
    expect(await listRes.text()).not.toContain("PROD-CANARY-31");
    // Without expansion the raw reference text is just text.
    expect((await get("dev", "USES_PROD", "path=/", dev.token)).status).toBe(200);
  });

  it("service token scoped to /api: ${dev:/billing/KEY} -> 403; includeImports from /billing -> 403", async () => {
    await put("dev", "/billing", "KEY", "BILLING-CANARY");
    await put("dev", "/api", "USES_BILLING", "${dev:/billing/KEY}");
    await put("dev", "/api", "OWN", "own");
    await addImport("dev", "/api", { environment: "dev", path: "/billing" });
    const { token } = await createServiceToken("app", {
      permission: "read",
      scopes: [{ environment: "dev", path: "/api" }],
    });
    const expanded = await get("dev", "USES_BILLING", "path=/api&expand=true", token);
    expect(expanded.status).toBe(403);
    expect(await expanded.text()).not.toContain("BILLING-CANARY");
    const imported = await list("dev", "path=/api&reveal=true&includeImports=true", token);
    expect(imported.status).toBe(403);
    const body = await imported.text();
    expect(body).not.toContain("BILLING-CANARY");
    expect(JSON.parse(body).error.message).toBe(
      "You do not have permission to read the import dev:/billing of dev:/api",
    );
    expect((await get("dev", "OWN", "path=/api", token)).status).toBe(200);
  });

  it("single get with includeImports: a local key never needs the imports; an imported or missing key does", async () => {
    await put("dev", "/billing", "KEY", "BILLING-CANARY");
    await put("dev", "/api", "OWN", "own");
    await addImport("dev", "/api", { environment: "dev", path: "/billing" });
    const { token } = await createServiceToken("app", {
      permission: "read",
      scopes: [{ environment: "dev", path: "/api" }],
    });
    const local = await get("dev", "OWN", "path=/api&includeImports=true", token);
    expect(local.status).toBe(200);
    const { secret } = await json<{ secret: SecretDto }>(local);
    expect(secret.value).toBe("own");
    expect(secret.importedFrom).toBeUndefined();

    const imported = await get("dev", "KEY", "path=/api&includeImports=true", token);
    expect(imported.status).toBe(403);
    expect(await imported.text()).not.toContain("BILLING-CANARY");
    // Missing locally: the answer depends on the forbidden import, so it is a 403, not a 404.
    expect((await get("dev", "NOPE", "path=/api&includeImports=true", token)).status).toBe(403);
  });

  it("a list whose values each reference one large secret many times -> 400 past 16 MiB, not OOM", async () => {
    await put("dev", "/", "BIG", "x".repeat(65_536));
    for (let i = 0; i < 17; i++) await put("dev", "/fan", `V${i}`, "${dev:/BIG}".repeat(16));
    const res = await list("dev", "path=/fan&reveal=true&expand=true");
    expect(res.status).toBe(400);
    expect((await errorOf(res)).message).toBe(
      "References add more than 16777216 bytes to one request",
    );
    // Each value alone is within limits.
    expect((await get("dev", "V0", "path=/fan&expand=true")).status).toBe(200);
  }, 60_000);

  it('value "echo ${HOME}" with expand -> 400 naming secret, reference and $${ hint; without -> 200', async () => {
    await put("dev", "/scripts", "CMD", "echo ${HOME}");
    const res = await get("dev", "CMD", "path=/scripts&expand=true");
    expect(res.status).toBe(400);
    const error = await errorOf(res);
    expect(error.code).toBe("bad_request");
    expect(error.message).toBe(
      "Unresolved reference ${HOME} in dev:/scripts/CMD; escape a literal with $${",
    );
    expect((await list("dev", "path=/scripts&reveal=true&expand=true")).status).toBe(400);
    const raw = await get("dev", "CMD", "path=/scripts");
    expect(raw.status).toBe(200);
    expect((await json<{ secret: SecretDto }>(raw)).secret.value).toBe("echo ${HOME}");
  });

  it("audit secret.read lists referenced addresses and imports, and no values", async () => {
    await put("prod", "/db", "PASSWORD", "AUDIT-CANARY-PW");
    await put("dev", "/app", "URL", "x${prod:/db/PASSWORD}");
    await put("dev", "/lib", "LIB", "AUDIT-CANARY-LIB");
    await addImport("dev", "/app", { environment: "dev", path: "/lib" });
    expect(
      (await list("dev", "path=/app&reveal=true&expand=true&includeImports=true")).status,
    ).toBe(200);
    const [row] = await auditRows("secret.read");
    expect(JSON.parse(row?.metadata ?? "null")).toEqual({
      path: "/app",
      keys: ["URL", "LIB"],
      referenced: [{ environment: "prod", path: "/db", key: "PASSWORD" }],
      imports: [{ environment: "dev", path: "/lib" }],
    });
    expect(JSON.stringify(await auditRows())).not.toContain("AUDIT-CANARY");
  });

  it("an unknown query flag value -> 400", async () => {
    expect((await list("dev", "path=/&expand=yes")).status).toBe(400);
    expect((await list("dev", "path=/&includeImports=1")).status).toBe(400);
  });
});

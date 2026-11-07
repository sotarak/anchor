import type { SecretDto } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { api, auditRows, createUserWithSession, json, jsonInit, resetDb } from "#test/support";

const base = "/api/v1/projects/app/environments/dev/secrets";
let token: string;

const put = (key: string, body: Record<string, unknown>) =>
  api(`${base}/${key}`, jsonInit("PUT", body, { token }));
const get = async (key: string) =>
  (
    await json<{ secret: SecretDto }>(
      await api(`${base}/${key}`, { headers: { authorization: `Bearer ${token}` } }),
    )
  ).secret;
const errorOf = async (res: Response) =>
  (await json<{ error: { code: string; message: string } }>(res)).error;

beforeEach(async () => {
  await resetDb();
  ({ token } = await createUserWithSession({ role: "owner", kind: "cli" }));
  const res = await api(
    "/api/v1/projects",
    jsonInit("POST", { slug: "app", name: "App" }, { token }),
  );
  expect(res.status).toBe(201);
});

describe("typed secret writes", () => {
  it("new secrets default to string + sensitive", async () => {
    expect((await put("K", { value: "v" })).status).toBe(201);
    expect(await get("K")).toMatchObject({ type: "string", sensitive: true, value: "v" });
  });

  it("stores the declared type and flag", async () => {
    const res = await put("PORT", { value: "8080", type: "number", sensitive: false });
    expect(res.status).toBe(201);
    expect((await json<{ secret: SecretDto }>(res)).secret).toMatchObject({
      type: "number",
      sensitive: false,
    });
    expect(await get("PORT")).toMatchObject({ type: "number", sensitive: false, value: "8080" });
  });

  it("rejects a value that does not fit its type", async () => {
    const res = await put("J", { value: "{a", type: "json" });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatchObject({
      code: "bad_request",
      message: "value is not valid for type json: not valid JSON",
    });
  });

  it("inherits type and flag when omitted (old clients)", async () => {
    await put("J", { value: '{"a":1}', type: "json", sensitive: false });
    expect((await put("J", { value: '{"b":2}' })).status).toBe(200);
    expect(await get("J")).toMatchObject({ type: "json", sensitive: false, value: '{"b":2}' });
    const bad = await put("J", { value: "oops" });
    expect(bad.status).toBe(400);
    expect((await errorOf(bad)).message).toBe("value is not valid for type json: not valid JSON");
  });

  it("changing only the type or flag makes a new version", async () => {
    await put("K", { value: "same" });
    const first = await put("K", { value: "same", sensitive: false });
    expect((await json<{ secret: SecretDto }>(first)).secret.version).toBe(2);
    const again = await put("K", { value: "same", sensitive: false });
    expect((await json<{ secret: SecretDto }>(again)).secret.version).toBe(2);
  });

  it("changing the type validates the current value", async () => {
    await put("K", { value: "abc" });
    expect((await put("K", { value: "abc", type: "number" })).status).toBe(400);
  });

  it("audit metadata records type and sensitive", async () => {
    await put("PORT", { value: "8080", type: "number", sensitive: false });
    const [created] = await auditRows("secret.created");
    expect(JSON.parse(created?.metadata ?? "null")).toMatchObject({
      type: "number",
      sensitive: false,
    });
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { api, auditRows, createUserWithSession, jsonInit, resetDb } from "#test/support";

const BASE = "/api/v1/projects/app/environments/dev/secrets";
const TAG = /^"[A-Za-z0-9_-]{22}"$/;
let token: string;

beforeEach(async () => {
  await resetDb();
  ({ token } = await createUserWithSession({ role: "owner" }));
  const res = await api(
    "/api/v1/projects",
    jsonInit("POST", { slug: "app", name: "App" }, { token }),
  );
  expect(res.status).toBe(201);
});

const put = (key: string, body: unknown) => api(`${BASE}/${key}`, jsonInit("PUT", body, { token }));
const listWith = (query: string, headers: Record<string, string> = {}, t = token) =>
  api(`${BASE}${query}`, { headers: { authorization: `Bearer ${t}`, ...headers } });

describe("conditional secrets list", () => {
  it("a list carries an ETag; the same tag gets 304 with no body and no audit row", async () => {
    await put("DB_URL", { value: "postgres://x" });
    const first = await listWith("?reveal=true");
    expect(first.status).toBe(200);
    const tag = first.headers.get("etag");
    expect(tag).toMatch(TAG);
    const reads = (await auditRows("secret.read")).length;
    const again = await listWith("?reveal=true", { "if-none-match": tag as string });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    expect(again.headers.get("etag")).toBe(tag);
    expect(again.headers.get("cache-control")).toBe("no-store");
    expect((await auditRows("secret.read")).length).toBe(reads);
  });

  it("a changed value or a different flag changes the tag; a change gets 200 and is audited", async () => {
    await put("DB_URL", { value: "a" });
    const tag = (await listWith("?reveal=true")).headers.get("etag") as string;
    expect((await listWith("?reveal=false")).headers.get("etag")).not.toBe(tag);
    await put("DB_URL", { value: "b" });
    const reads = (await auditRows("secret.read")).length;
    const changed = await listWith("?reveal=true", { "if-none-match": tag });
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(tag);
    expect((await auditRows("secret.read")).length).toBe(reads + 1);
  });

  it("a changed comment changes the tag", async () => {
    await put("DB_URL", { value: "a", comment: "one" });
    const tag = (await listWith("?reveal=true")).headers.get("etag") as string;
    await put("DB_URL", { value: "a", comment: "two" });
    expect((await listWith("?reveal=true", { "if-none-match": tag })).status).toBe(200);
  });

  it("an unknown or stale tag gets 200 with the current tag", async () => {
    await put("DB_URL", { value: "a" });
    const res = await listWith("?reveal=true", { "if-none-match": '"AAAAAAAAAAAAAAAAAAAAAA"' });
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toMatch(TAG);
  });

  it("authorization runs before the tag: a token without access gets 403, never 304", async () => {
    await put("DB_URL", { value: "a" });
    const tag = (await listWith("?reveal=true")).headers.get("etag") as string;
    const outsider = await createUserWithSession({ role: "member", email: "out@example.test" });
    const res = await listWith("?reveal=true", { "if-none-match": tag }, outsider.token);
    expect(res.status).toBe(403);
  });
});

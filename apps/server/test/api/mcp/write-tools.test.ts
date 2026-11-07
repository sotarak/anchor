import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  api,
  auditRows,
  createMember,
  createUserWithSession,
  jsonInit,
  mcpTool,
  oauthTokenFor,
  resetDb,
} from "#test/support";

const CANARY = "s3cret-CANARY-pw";
let owner: { userId: string; token: string };
let token: string;
const at = { project: "app", environment: "prod" };

const secretCount = async () =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM secrets").first<{ n: number }>())?.n;
const clientIdOf = async () =>
  (
    await env.DB.prepare("SELECT client_id FROM oauth_grants ORDER BY created_at DESC").first<{
      client_id: string;
    }>()
  )?.client_id;

beforeEach(async () => {
  await resetDb();
  owner = await createUserWithSession({ role: "owner", kind: "cli" });
  await api(
    "/api/v1/projects",
    jsonInit("POST", { name: "app", slug: "app" }, { token: owner.token }),
  );
  token = await oauthTokenFor(owner.userId, ["secrets:read", "secrets:write"]);
});

describe("MCP write tools", () => {
  it("set_secret creates, then updates, then reports unchanged — never echoing the value", async () => {
    const a = await mcpTool(token, "set_secret", { ...at, key: "DB_PASSWORD", value: CANARY });
    expect(a.isError).toBe(false);
    expect(a.data).toMatchObject({
      result: "created",
      secret: { key: "DB_PASSWORD", version: 1, sensitive: true, type: "string" },
    });
    const b = await mcpTool(token, "set_secret", {
      ...at,
      key: "DB_PASSWORD",
      value: "other-CANARY",
    });
    expect(b.data).toMatchObject({ result: "updated", secret: { version: 2 } });
    const c = await mcpTool(token, "set_secret", {
      ...at,
      key: "DB_PASSWORD",
      value: "other-CANARY",
    });
    expect(c.data).toMatchObject({ result: "unchanged", secret: { version: 2 } });
    for (const r of [a, b, c]) expect(r.text).not.toContain("CANARY");
  });

  it("set_secret honours type and sensitive, and a bad typed value is a tool error without it", async () => {
    const ok = await mcpTool(token, "set_secret", {
      ...at,
      key: "PORT",
      value: "9000",
      type: "number",
      sensitive: false,
      comment: "http port",
    });
    expect(ok.data).toMatchObject({
      secret: { type: "number", sensitive: false, comment: "http port" },
    });
    const bad = await mcpTool(token, "set_secret", {
      ...at,
      key: "PORT",
      value: "nine-thousand-CANARY",
    });
    expect(bad.isError).toBe(true);
    expect(bad.text).not.toContain("CANARY");
    expect(bad.text).toMatch(/number/i);
  });

  it("without secrets:write, set_secret is refused with the write copy and nothing is written", async () => {
    const readOnly = await oauthTokenFor(owner.userId, ["secrets:read"]);
    const r = await mcpTool(readOnly, "set_secret", { ...at, key: "K", value: "v" });
    expect(r.isError).toBe(true);
    expect(r.text).toBe(
      "This needs the secrets:write permission. Remove and reconnect the Anchor MCP server.",
    );
    expect(await secretCount()).toBe(0);
  });

  it("a viewer's agent with secrets:write gets a tool error and nothing is written", async () => {
    const viewer = await createMember("app", { role: "viewer" });
    const viewerToken = await oauthTokenFor(viewer.userId, ["secrets:read", "secrets:write"]);
    const r = await mcpTool(viewerToken, "set_secret", { ...at, key: "K", value: "v" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/permission/i);
    expect(await secretCount()).toBe(0);
    const d = await mcpTool(viewerToken, "delete_secret", { ...at, key: "K" });
    expect(d.isError).toBe(true);
  });

  it("delete_secret deletes", async () => {
    await mcpTool(token, "set_secret", { ...at, key: "K", value: "v" });
    const r = await mcpTool(token, "delete_secret", { ...at, key: "K" });
    expect(r.isError).toBe(false);
    expect(await secretCount()).toBe(0);
    const again = await mcpTool(token, "delete_secret", { ...at, key: "K" });
    expect(again.isError).toBe(true);
    expect(again.text).toBe("Secret not found");
  });

  it("writes through MCP are audited with via mcp and the client id", async () => {
    await mcpTool(token, "set_secret", { ...at, key: "K", value: "v1" });
    await mcpTool(token, "set_secret", { ...at, key: "K", value: "v2" });
    await mcpTool(token, "delete_secret", { ...at, key: "K" });
    const clientId = await clientIdOf();
    for (const action of ["secret.created", "secret.updated", "secret.deleted"] as const) {
      const [row] = await auditRows(action);
      expect(JSON.parse(row?.metadata ?? "{}"), action).toMatchObject({ via: "mcp", clientId });
      expect(row?.actor_id).toBe(owner.userId);
    }
  });

  it("REST writes carry no via field", async () => {
    await api(
      "/api/v1/projects/app/environments/prod/secrets/K",
      jsonInit("PUT", { value: "v" }, { token: owner.token }),
    );
    const [row] = await auditRows("secret.created");
    expect(JSON.parse(row?.metadata ?? "{}")).not.toHaveProperty("via");
  });
});

describe("MCP reveal", () => {
  beforeEach(async () => {
    await api(
      "/api/v1/projects/app/environments/prod/secrets/DB_PASSWORD",
      jsonInit("PUT", { value: CANARY }, { token: owner.token }),
    );
    await api(
      "/api/v1/projects/app/environments/prod/secrets/DB_URL",
      jsonInit(
        "PUT",
        { value: "pg://u:${DB_PASSWORD}@h", sensitive: false },
        { token: owner.token },
      ),
    );
  });

  it("get_secret with reveal and secrets:reveal returns the expanded value and audits secret.read", async () => {
    const revealer = await oauthTokenFor(owner.userId, ["secrets:read", "secrets:reveal"]);
    const r = await mcpTool(revealer, "get_secret", { ...at, key: "DB_URL", reveal: true });
    expect(r.isError).toBe(false);
    expect(r.data).toMatchObject({ key: "DB_URL", value: `pg://u:${CANARY}@h` });
    const p = await mcpTool(revealer, "get_secret", { ...at, key: "DB_PASSWORD", reveal: true });
    expect(p.data).toMatchObject({ value: CANARY });
    const rows = await auditRows("secret.read");
    expect(rows).toHaveLength(2);
    const clientId = await clientIdOf();
    expect(JSON.parse(rows[0]?.metadata ?? "{}")).toMatchObject({
      via: "mcp",
      clientId,
      keys: ["DB_URL"],
      referenced: [{ environment: "prod", path: "/", key: "DB_PASSWORD" }],
    });
    expect(JSON.stringify(rows)).not.toContain(CANARY);
  });

  it("reads without reveal are not audited as secret.read", async () => {
    await mcpTool(token, "get_secret", { ...at, key: "DB_URL" });
    await mcpTool(token, "list_secrets", at);
    expect(await auditRows("secret.read")).toHaveLength(0);
  });
});

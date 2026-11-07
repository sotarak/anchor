import { beforeEach, describe, expect, it } from "vitest";
import {
  api,
  createMember,
  createUserWithSession,
  jsonInit,
  mcpCall,
  mcpTool,
  oauthTokenFor,
  resetDb,
} from "#test/support";

const CANARY = "s3cret-CANARY-pw";
let owner: { userId: string; token: string };
let token: string;

async function put(env: string, key: string, body: object, project = "app") {
  const res = await api(
    `/api/v1/projects/${project}/environments/${env}/secrets/${key}`,
    jsonInit("PUT", body, { token: owner.token }),
  );
  if (res.status >= 300) throw new Error(`put ${key}: ${res.status} ${await res.text()}`);
}

beforeEach(async () => {
  await resetDb();
  owner = await createUserWithSession({ role: "owner", kind: "cli" });
  for (const slug of ["app", "other"]) {
    await api("/api/v1/projects", jsonInit("POST", { name: slug, slug }, { token: owner.token }));
  }
  await put("prod", "DB_PASSWORD", { value: CANARY });
  await put("prod", "DB_URL", {
    value: "postgres://u:${DB_PASSWORD}@db/app",
    sensitive: false,
    comment: "connection string",
  });
  await put("prod", "PORT", { value: "9000", type: "number", sensitive: false });
  await put("prod", "API_KEY", { value: "api-CANARY", path: "/api" });
  token = await oauthTokenFor(owner.userId, ["secrets:read", "secrets:write"]);
});

describe("MCP read tools", () => {
  it("tools/list names exactly the 8 tools, read-only hints on the 6 read tools", async () => {
    const res = await mcpCall(token, "tools/list");
    const body = (await res.json()) as {
      result: { tools: { name: string; annotations?: Record<string, boolean> }[] };
    };
    const tools = body.result.tools;
    expect(tools.map((t) => t.name).sort()).toEqual([
      "delete_secret",
      "get_secret",
      "list_environments",
      "list_folders",
      "list_projects",
      "list_secrets",
      "secret_history",
      "set_secret",
    ]);
    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name);
    expect(readOnly.sort()).toEqual([
      "get_secret",
      "list_environments",
      "list_folders",
      "list_projects",
      "list_secrets",
      "secret_history",
    ]);
    const del = tools.find((t) => t.name === "delete_secret");
    expect(del?.annotations?.destructiveHint).toBe(true);
  });

  it("list_projects shows only the user's projects with the role", async () => {
    const member = await createMember("app", { role: "viewer" });
    const memberToken = await oauthTokenFor(member.userId);
    const r = await mcpTool(memberToken, "list_projects");
    expect(r.isError).toBe(false);
    expect(r.data).toEqual({ projects: [{ slug: "app", name: "app", role: "viewer" }] });
    const all = await mcpTool(token, "list_projects");
    expect(
      (all.data as { projects: { slug: string }[] }).projects.map((p) => p.slug).sort(),
    ).toEqual(["app", "other"]);
  });

  it("list_environments and list_folders", async () => {
    const envs = await mcpTool(token, "list_environments", { project: "app" });
    expect(
      (envs.data as { environments: { slug: string }[] }).environments.map((e) => e.slug),
    ).toEqual(["dev", "staging", "prod"]);
    const folders = await mcpTool(token, "list_folders", { project: "app", environment: "prod" });
    expect(folders.data).toEqual({ folders: ["/api"] });
  });

  it("list_secrets returns values only for non-sensitive rows, never expanded", async () => {
    const r = await mcpTool(token, "list_secrets", { project: "app", environment: "prod" });
    expect(r.isError).toBe(false);
    const secrets = (r.data as { secrets: Record<string, unknown>[] }).secrets;
    const byKey = Object.fromEntries(secrets.map((s) => [s.key, s]));
    expect(byKey.DB_PASSWORD).not.toHaveProperty("value");
    expect(byKey.DB_PASSWORD).toMatchObject({ sensitive: true, type: "string", version: 1 });
    expect(byKey.DB_URL).toMatchObject({
      value: "postgres://u:${DB_PASSWORD}@db/app",
      comment: "connection string",
      sensitive: false,
    });
    expect(byKey.PORT).toMatchObject({ value: "9000", type: "number" });
    expect(r.text).not.toContain(CANARY);
  });

  it("get_secret on a sensitive key without reveal returns metadata only", async () => {
    const r = await mcpTool(token, "get_secret", {
      project: "app",
      environment: "prod",
      key: "DB_PASSWORD",
    });
    expect(r.isError).toBe(false);
    expect(r.data).toMatchObject({ key: "DB_PASSWORD", sensitive: true });
    expect(r.data).not.toHaveProperty("value");
    expect(r.text).not.toContain(CANARY);
  });

  it("get_secret with reveal but without secrets:reveal is a tool error with the spec copy", async () => {
    const r = await mcpTool(token, "get_secret", {
      project: "app",
      environment: "prod",
      key: "DB_PASSWORD",
      reveal: true,
    });
    expect(r.isError).toBe(true);
    expect(r.text).toBe(
      'This needs the secrets:reveal permission. Remove and reconnect the Anchor MCP server, and tick "Also allow reading sensitive values".',
    );
  });

  it("a non-sensitive ${DB_PASSWORD} via get_secret returns the literal", async () => {
    const r = await mcpTool(token, "get_secret", {
      project: "app",
      environment: "prod",
      key: "DB_URL",
    });
    expect(r.data).toMatchObject({ value: "postgres://u:${DB_PASSWORD}@db/app" });
    expect(r.text).not.toContain(CANARY);
  });

  it("a member restricted away from prod gets the API's refusal", async () => {
    const member = await createMember("app", { role: "developer", environments: ["dev"] });
    const memberToken = await oauthTokenFor(member.userId);
    const api403 = await api("/api/v1/projects/app/environments/prod/secrets?path=%2F", {
      headers: { authorization: `Bearer ${member.token}` },
    });
    const message = ((await api403.json()) as { error: { message: string } }).error.message;
    const r = await mcpTool(memberToken, "list_secrets", { project: "app", environment: "prod" });
    expect(r.isError).toBe(true);
    expect(r.text).toBe(message);
  });

  it("secret_history returns versions without values", async () => {
    await put("prod", "DB_PASSWORD", { value: "second-CANARY" });
    const r = await mcpTool(token, "secret_history", {
      project: "app",
      environment: "prod",
      key: "DB_PASSWORD",
    });
    const versions = (r.data as { versions: Record<string, unknown>[] }).versions;
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(r.text).not.toContain("CANARY");
  });

  it("an unknown project is a tool error, not a crash", async () => {
    const r = await mcpTool(token, "list_secrets", { project: "nope", environment: "prod" });
    expect(r.isError).toBe(true);
    expect(r.text).toBe("Project not found");
  });

  it("without secrets:read, read tools are refused", async () => {
    const writeOnly = await oauthTokenFor(owner.userId, ["secrets:write"]);
    const r = await mcpTool(writeOnly, "list_projects");
    expect(r.isError).toBe(true);
    expect(r.text).toContain("secrets:read");
  });
});

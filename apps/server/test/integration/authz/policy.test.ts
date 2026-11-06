import { env } from "cloudflare:workers";
import type { InstanceRole } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { type Action, authorize, visibleEnvironmentIds } from "#src/authz/policy";
import { getRootKeyring } from "#src/crypto/keyring";
import type { Principal } from "#src/env";
import { ApiError } from "#src/lib/errors";
import { createProject, listEnvironments, type ProjectRow } from "#src/projects/repo";
import { createMember, resetDb } from "#test/support";

const db = env.DB;
const ALL_ACTIONS: Action[] = [
  "project:create",
  "project:read",
  "project:update",
  "project:delete",
  "environment:manage",
  "secret:read",
  "secret:write",
  "member:manage",
  "service_token:manage",
  "audit:read",
  "user:manage",
  "invite:manage",
];

let project: ProjectRow;
let other: ProjectRow;
let envs: Record<string, string>;

const user = (userId: string, role: InstanceRole = "member"): Principal => ({
  type: "user",
  userId,
  email: `${userId}@x.io`,
  name: userId,
  role,
  sessionId: "s",
});

const token = (
  overrides: Partial<Extract<Principal, { type: "service_token" }>> = {},
): Principal => ({
  type: "service_token",
  tokenId: "t1",
  projectId: project.id,
  name: "ci",
  permission: "read",
  scopes: [{ environmentId: envs.prod ?? "", path: "/api" }],
  expiresAt: Date.now() + 86_400_000,
  ...overrides,
});

/** A full resource for any action: secret actions need environment and path. */
const resource = (environment = "dev", path = "/", projectId = project.id) => ({
  projectId,
  environmentId: envs[environment] ?? "",
  path,
});

async function denied(p: Promise<void>): Promise<boolean> {
  try {
    await p;
    return false;
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) return true;
    throw err;
  }
}

beforeEach(async () => {
  await resetDb();
  const keyring = await getRootKeyring(env);
  project = await createProject(db, keyring, { name: "App", slug: "app" }, Date.now());
  other = await createProject(db, keyring, { name: "Other", slug: "other" }, Date.now());
  envs = Object.fromEntries((await listEnvironments(db, project.id)).map((e) => [e.slug, e.id]));
});

describe("authorize", () => {
  it("owner and admin are allowed every action", async () => {
    for (const role of ["owner", "admin"] as const) {
      for (const action of ALL_ACTIONS) {
        await expect(
          authorize(db, user("boss", role), action, resource()),
          `${role} ${action}`,
        ).resolves.toBeUndefined();
      }
    }
  });

  it("member without membership is denied project:read", async () => {
    const { userId } = await createMember("other", { role: "admin" });
    expect(await denied(authorize(db, user(userId), "project:read", resource()))).toBe(true);
  });

  it("viewer can read but not write secrets", async () => {
    const { userId } = await createMember("app", { role: "viewer" });
    const p = user(userId);
    await expect(authorize(db, p, "project:read", resource())).resolves.toBeUndefined();
    await expect(authorize(db, p, "secret:read", resource("prod"))).resolves.toBeUndefined();
    expect(await denied(authorize(db, p, "secret:write", resource("dev")))).toBe(true);
  });

  it("developer can write in allowed env and is denied in a restricted env", async () => {
    const { userId } = await createMember("app", { role: "developer", environments: ["dev"] });
    const p = user(userId);
    await expect(authorize(db, p, "secret:write", resource("dev"))).resolves.toBeUndefined();
    await expect(authorize(db, p, "secret:read", resource("dev"))).resolves.toBeUndefined();
    expect(await denied(authorize(db, p, "secret:write", resource("prod")))).toBe(true);
    expect(await denied(authorize(db, p, "secret:read", resource("prod")))).toBe(true);
  });

  it("member cannot manage environments, members or tokens unless project admin", async () => {
    const managed: Action[] = [
      "environment:manage",
      "project:update",
      "member:manage",
      "service_token:manage",
      "audit:read",
    ];
    const dev = await createMember("app", { role: "developer" });
    const admin = await createMember("app", { role: "admin" });
    for (const action of managed) {
      expect(await denied(authorize(db, user(dev.userId), action, resource())), action).toBe(true);
      await expect(
        authorize(db, user(admin.userId), action, resource()),
        action,
      ).resolves.toBeUndefined();
    }
  });

  it("member is denied project:create, project:delete, user:manage, invite:manage and instance audit", async () => {
    const admin = await createMember("app", { role: "admin" });
    const p = user(admin.userId);
    for (const action of ["project:create", "user:manage", "invite:manage"] as const) {
      expect(await denied(authorize(db, p, action)), action).toBe(true);
    }
    expect(await denied(authorize(db, p, "project:delete", resource()))).toBe(true);
    expect(await denied(authorize(db, p, "audit:read"))).toBe(true);
  });

  it("service token denied outside its project, env, path, and denied write when read-only", async () => {
    const t = token();
    await expect(
      authorize(db, t, "secret:read", resource("prod", "/api")),
    ).resolves.toBeUndefined();
    await expect(
      authorize(db, t, "secret:read", resource("prod", "/api/db")),
    ).resolves.toBeUndefined();
    expect(await denied(authorize(db, t, "secret:read", resource("prod", "/apix")))).toBe(true);
    expect(await denied(authorize(db, t, "secret:read", resource("prod", "/")))).toBe(true);
    expect(await denied(authorize(db, t, "secret:read", resource("staging", "/api")))).toBe(true);
    expect(await denied(authorize(db, t, "secret:read", resource("prod", "/api", other.id)))).toBe(
      true,
    );
    expect(await denied(authorize(db, t, "secret:write", resource("prod", "/api")))).toBe(true);
    const rw = token({ permission: "read-write" });
    await expect(
      authorize(db, rw, "secret:write", resource("prod", "/api")),
    ).resolves.toBeUndefined();
  });

  it("service token denied every non-secret action except project:read", async () => {
    const t = token({ permission: "read-write" });
    await expect(authorize(db, t, "project:read", resource())).resolves.toBeUndefined();
    expect(await denied(authorize(db, t, "project:read", resource("dev", "/", other.id)))).toBe(
      true,
    );
    for (const action of ALL_ACTIONS) {
      if (action === "project:read" || action.startsWith("secret:")) continue;
      expect(await denied(authorize(db, t, action, resource())), action).toBe(true);
    }
  });

  it("authorize throws a programming error when secret action lacks environmentId", async () => {
    const owner = user("boss", "owner");
    await expect(authorize(db, owner, "secret:read", { projectId: project.id })).rejects.toThrow(
      "resource required for secret:read",
    );
    await expect(
      authorize(db, owner, "secret:write", { projectId: project.id, environmentId: "e" }),
    ).rejects.toThrow("resource required for secret:write");
    await expect(authorize(db, owner, "project:update")).rejects.toThrow(
      "resource required for project:update",
    );
  });
});

describe("visibleEnvironmentIds", () => {
  it("is all for owners, admins and unrestricted members; the set for restricted ones", async () => {
    expect(await visibleEnvironmentIds(db, user("boss", "admin"), project.id)).toBe("all");
    const open = await createMember("app", { role: "viewer" });
    expect(await visibleEnvironmentIds(db, user(open.userId), project.id)).toBe("all");
    const restricted = await createMember("app", { role: "viewer", environments: ["dev"] });
    expect(await visibleEnvironmentIds(db, user(restricted.userId), project.id)).toEqual(
      new Set([envs.dev]),
    );
    expect(await visibleEnvironmentIds(db, user(restricted.userId), other.id)).toEqual(new Set());
    expect(await visibleEnvironmentIds(db, token(), project.id)).toEqual(new Set([envs.prod]));
    expect(await visibleEnvironmentIds(db, token(), other.id)).toEqual(new Set());
  });
});

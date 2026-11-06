import { env } from "cloudflare:workers";
import type { AuditEventDto } from "@anchor/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  api,
  createMember,
  createServiceToken,
  createUserWithSession,
  json,
  jsonInit,
  resetDb,
} from "#test/support";

type Page = { events: AuditEventDto[]; nextCursor: string | null };
const bearer = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });
const toB64Url = (s: string) =>
  btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

let owner: { userId: string; token: string };

type Seed = {
  id: string;
  at: number;
  action?: string;
  actorId?: string;
  projectId?: string | null;
};
async function insertEvents(rows: Seed[]): Promise<void> {
  const stmt = env.DB.prepare(
    `INSERT INTO audit_events (id, at, actor_type, actor_id, actor_label, action, project_id, metadata)
     VALUES (?, ?, 'user', ?, 'seed@example.test', ?, ?, ?)`,
  );
  await env.DB.batch(
    rows.map((r) =>
      stmt.bind(
        r.id,
        r.at,
        r.actorId ?? "seed-actor",
        r.action ?? "project.updated",
        r.projectId ?? null,
        JSON.stringify({ n: r.id }),
      ),
    ),
  );
}

async function page(t: string, query: string): Promise<Page> {
  const res = await api(`/api/v1/audit?${query}`, bearer(t));
  expect(res.status).toBe(200);
  return json<Page>(res);
}

beforeEach(async () => {
  await resetDb();
  owner = await createUserWithSession({ role: "owner", kind: "cli" });
});

describe("audit query API", () => {
  it("pagination walks all events without duplicates or gaps", async () => {
    const base = Date.now() - 1_000_000;
    const seeds: Seed[] = Array.from({ length: 120 }, (_, i) => ({
      id: `evt-${String(i).padStart(3, "0")}`,
      // Events 40..44 share one timestamp (the next test puts such a run across a page edge).
      at: i >= 40 && i <= 44 ? base + 40_000 : base + i * 1000,
    }));
    // Shuffle insertion order so the result order comes from ORDER BY, not rowid.
    await insertEvents([...seeds].reverse());
    const sizes: number[] = [];
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const p: Page = await page(owner.token, `limit=50${cursor ? `&before=${cursor}` : ""}`);
      sizes.push(p.events.length);
      seen.push(...p.events.map((e) => e.id));
      cursor = p.nextCursor;
    } while (cursor);
    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(seen).size).toBe(120);
    expect([...seen].sort()).toEqual(seeds.map((s) => s.id).sort());
    // Strictly descending by (at, id).
    const byId = new Map(seeds.map((s) => [s.id, s.at]));
    for (let i = 1; i < seen.length; i++) {
      const [prev, cur] = [seen[i - 1] ?? "", seen[i] ?? ""];
      const [pa, ca] = [byId.get(prev) ?? 0, byId.get(cur) ?? 0];
      expect(pa > ca || (pa === ca && prev > cur)).toBe(true);
    }
  });

  it("a page boundary inside a run of equal timestamps loses nothing", async () => {
    const at = Date.now() - 5000;
    await insertEvents(Array.from({ length: 7 }, (_, i) => ({ id: `same-${i}`, at })));
    const first = await page(owner.token, "limit=3");
    const second = await page(owner.token, `limit=3&before=${first.nextCursor}`);
    const third = await page(owner.token, `limit=3&before=${second.nextCursor}`);
    expect([...first.events, ...second.events, ...third.events].map((e) => e.id)).toEqual([
      "same-6",
      "same-5",
      "same-4",
      "same-3",
      "same-2",
      "same-1",
      "same-0",
    ]);
    expect(third.nextCursor).toBeNull();
  });

  it("filters by action, actorId and projectId", async () => {
    const at = Date.now() - 10_000;
    await insertEvents([
      { id: "a", at, action: "secret.read", actorId: "u1", projectId: "p1" },
      { id: "b", at: at + 1, action: "secret.read", actorId: "u2", projectId: "p2" },
      { id: "c", at: at + 2, action: "member.added", actorId: "u1", projectId: "p1" },
    ]);
    const ids = async (q: string) => (await page(owner.token, q)).events.map((e) => e.id);
    expect(await ids("action=secret.read")).toEqual(["b", "a"]);
    expect(await ids("actorId=u1")).toEqual(["c", "a"]);
    expect(await ids("projectId=p1")).toEqual(["c", "a"]);
    expect(await ids("projectId=p1&action=secret.read&actorId=u1")).toEqual(["a"]);
    expect(await ids("action=secret.read&limit=1")).toEqual(["b"]);
  });

  it("tampered cursor -> 400, limit=500 -> 400, unknown action -> 400", async () => {
    for (const before of [
      "garbage!!",
      toB64Url("abc:def"),
      toB64Url("123"),
      toB64Url("12:"),
      toB64Url("1e3:x"),
    ]) {
      const res = await api(
        `/api/v1/audit?before=${encodeURIComponent(before)}`,
        bearer(owner.token),
      );
      expect(res.status, before).toBe(400);
    }
    expect((await api("/api/v1/audit?limit=500", bearer(owner.token))).status).toBe(400);
    expect((await api("/api/v1/audit?action=nope", bearer(owner.token))).status).toBe(400);
  });

  it("metadata is returned parsed as an object", async () => {
    await insertEvents([{ id: "m1", at: Date.now() - 1000 }]);
    const [event] = (await page(owner.token, "")).events;
    expect(event).toMatchObject({
      id: "m1",
      actor: { type: "user", id: "seed-actor", label: "seed@example.test" },
      action: "project.updated",
      metadata: { n: "m1" },
    });
  });

  it("instance audit: admin 200, member 403, service token 403", async () => {
    const admin = await createUserWithSession({ role: "admin", kind: "cli" });
    const member = await createUserWithSession({ role: "member", kind: "cli" });
    expect((await api("/api/v1/audit", bearer(admin.token))).status).toBe(200);
    expect((await api("/api/v1/audit", bearer(member.token))).status).toBe(403);
    await api(
      "/api/v1/projects",
      jsonInit("POST", { name: "App", slug: "app" }, { token: owner.token }),
    );
    const { token } = await createServiceToken("app", {
      permission: "read",
      scopes: [{ environment: "dev", path: "/" }],
    });
    expect((await api("/api/v1/audit", bearer(token))).status).toBe(403);
    expect((await api("/api/v1/projects/app/audit", bearer(token))).status).toBe(403);
  });

  it("project audit: project admin sees only that project; developer 403; projectId query param cannot widen scope", async () => {
    const ids: Record<string, string> = {};
    for (const slug of ["app", "other"]) {
      const res = await api(
        "/api/v1/projects",
        jsonInit("POST", { name: slug, slug }, { token: owner.token }),
      );
      ids[slug] = (await json<{ project: { id: string } }>(res)).project.id;
    }
    await api(
      "/api/v1/projects/other/environments",
      jsonInit("POST", { name: "QA", slug: "qa" }, { token: owner.token }),
    );
    const admin = await createMember("app", { role: "admin" });
    const developer = await createMember("app", { role: "developer" });
    const res = await api("/api/v1/projects/app/audit", bearer(admin.token));
    expect(res.status).toBe(200);
    const events = (await json<Page>(res)).events;
    expect(events.length).toBeGreaterThan(0);
    expect(new Set(events.map((e) => e.projectId))).toEqual(new Set([ids.app]));
    const widened = await api(
      `/api/v1/projects/app/audit?projectId=${ids.other}`,
      bearer(admin.token),
    );
    expect(widened.status).toBe(200);
    expect(new Set((await json<Page>(widened)).events.map((e) => e.projectId))).toEqual(
      new Set([ids.app]),
    );
    expect((await api("/api/v1/projects/app/audit", bearer(developer.token))).status).toBe(403);
    expect((await api("/api/v1/projects/other/audit", bearer(admin.token))).status).toBe(403);
    expect((await api("/api/v1/audit", bearer(admin.token))).status).toBe(403);
  });
});

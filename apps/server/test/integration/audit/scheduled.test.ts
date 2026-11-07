import { createExecutionContext, createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { purgeAudit } from "#src/audit/repo";
import { handleScheduled } from "#src/audit/scheduled";
import { resetDb } from "#test/support";

const DAY = 86_400_000;

async function insertAt(id: string, at: number): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO audit_events (id, at, actor_type, action) VALUES (?, ?, 'anonymous', 'auth.login_failed')",
  )
    .bind(id, at)
    .run();
}
const ids = async () =>
  (
    await env.DB.prepare("SELECT id FROM audit_events ORDER BY id").all<{ id: string }>()
  ).results.map((r) => r.id);

beforeEach(resetDb);

describe("audit retention", () => {
  it("scheduled purge deletes only rows older than 365 days", async () => {
    const now = Date.now();
    await insertAt("old", now - 366 * DAY);
    await insertAt("young", now - 364 * DAY);
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await handleScheduled(
        createScheduledController({ cron: "0 3 * * *" }),
        env,
        createExecutionContext(),
      );
      expect(await ids()).toEqual(["young"]);
      const lines = logs.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes('"audit_purged"') && l.includes('"count":1'))).toBe(true);
    } finally {
      logs.mockRestore();
    }
  });

  it("purge does not abort when the worker clock runs ahead of D1's", async () => {
    const now = Date.now();
    await insertAt("old", now - 366 * DAY);
    // Inside retention by D1's clock, but past the cutoff for a worker clock 5 s ahead. The
    // retention trigger would abort the whole DELETE if purge tried to remove it.
    await insertAt("edge", now - 365 * DAY + 2000);
    expect(await purgeAudit(env.DB, now + 5000)).toBe(1);
    expect(await ids()).toEqual(["edge"]);
  });

  it("the retention trigger still blocks deleting young rows directly", async () => {
    await insertAt("young", Date.now() - DAY);
    await expect(env.DB.prepare("DELETE FROM audit_events").run()).rejects.toThrow(/retention/);
  });
});

describe("cli login purge", () => {
  it("deletes rows expired for more than a day", async () => {
    const now = Date.now();
    const rows: [string, string, number][] = [
      ["old", "BBBB-BBBB", now - 2 * DAY],
      ["recent", "CCCC-CCCC", now - 3_600_000],
      ["pending", "DDDD-DDDD", now + 600_000],
    ];
    for (const [id, code, expiresAt] of rows) {
      await env.DB.prepare(
        "INSERT INTO cli_logins (id, user_code, status, created_at, expires_at) VALUES (?, ?, 'pending', 0, ?)",
      )
        .bind(id, code, expiresAt)
        .run();
    }
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await handleScheduled(
        createScheduledController({ cron: "0 3 * * *" }),
        env,
        createExecutionContext(),
      );
      const left = await env.DB.prepare("SELECT id FROM cli_logins ORDER BY id").all<{
        id: string;
      }>();
      expect(left.results.map((r) => r.id)).toEqual(["pending", "recent"]);
      const lines = logs.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes('"cli_logins_purged"') && l.includes('"count":1'))).toBe(
        true,
      );
    } finally {
      logs.mockRestore();
    }
  });

  it("the daily job purges expired OAuth codes and tokens and logs oauth_purged", async () => {
    const now = Date.now();
    await env.DB.prepare(
      "INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES ('old', 'x', '[]', ?)",
    )
      .bind(now - 2 * DAY)
      .run();
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await handleScheduled(
        createScheduledController({ cron: "0 3 * * *" }),
        env,
        createExecutionContext(),
      );
      const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM oauth_clients").first();
      expect(left?.n).toBe(0);
      const lines = logs.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes('"oauth_purged"') && l.includes('"count":1'))).toBe(true);
    } finally {
      logs.mockRestore();
    }
  });
});

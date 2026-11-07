import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createUserWithSession, listAppTables, resetDb } from "#test/support";

const db = env.DB;
const insert = (id: string, userCode: string, status = "pending", userId: string | null = null) =>
  db
    .prepare(
      "INSERT INTO cli_logins (id, user_code, status, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, 0, 1)",
    )
    .bind(id, userCode, status, userId)
    .run();

beforeEach(resetDb);

describe("migration 0006", () => {
  it("creates cli_logins", async () => {
    expect(await listAppTables()).toEqual(expect.arrayContaining(["cli_logins"]));
  });

  it("rejects an unknown status", async () => {
    await expect(insert("a", "BBBB-BBBB", "nope")).rejects.toThrow();
  });

  it("user codes are unique", async () => {
    await insert("a", "BBBB-BBBB");
    await expect(insert("b", "BBBB-BBBB")).rejects.toThrow();
  });

  it("deleting a user deletes that user's rows", async () => {
    const { userId } = await createUserWithSession({ role: "member", kind: "cli" });
    await insert("a", "BBBB-BBBB", "approved", userId);
    await insert("b", "CCCC-CCCC");
    await db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
    const rows = await db.prepare("SELECT id FROM cli_logins").all<{ id: string }>();
    expect(rows.results.map((r) => r.id)).toEqual(["b"]);
  });
});

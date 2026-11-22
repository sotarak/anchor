import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createUserWithSession, listAppTables, resetDb } from "#test/support";

const db = env.DB;
const MFA_TABLES = [
  "totp_credentials",
  "recovery_codes",
  "webauthn_credentials",
  "mfa_tickets",
  "webauthn_challenges",
];

beforeEach(resetDb);

const count = async (table: string) =>
  (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n;

async function seed(userId: string, sessionId: string) {
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO totp_credentials (user_id, root_key_id, iv, secret_ct, created_at) VALUES (?, 'rk', ?, ?, ?)",
      )
      .bind(userId, new Uint8Array(12), new Uint8Array(36), now),
    db
      .prepare(
        "INSERT INTO recovery_codes (id, user_id, code_hash, created_at) VALUES ('r1', ?, 'h', ?)",
      )
      .bind(userId, now),
    db
      .prepare(
        `INSERT INTO webauthn_credentials (id, user_id, rp_id, public_key, counter, name, backed_up, created_at)
         VALUES ('c1', ?, 'anchor.test', ?, 0, 'Key', 0, ?)`,
      )
      .bind(userId, new Uint8Array(4), now),
    db
      .prepare(
        "INSERT INTO mfa_tickets (id, user_id, client, created_at, expires_at) VALUES ('t1', ?, 'web', ?, ?)",
      )
      .bind(userId, now, now + 1),
    db
      .prepare(
        `INSERT INTO webauthn_challenges (id, user_id, purpose, ticket_id, session_id, created_at, expires_at)
         VALUES ('ch1', ?, 'reauth', NULL, ?, ?, ?)`,
      )
      .bind(userId, sessionId, now, now + 1),
  ]);
}

describe("migration 0010", () => {
  it("creates the MFA tables and sessions.reauth_at", async () => {
    expect(await listAppTables()).toEqual(expect.arrayContaining(MFA_TABLES));
    const { results } = await db.prepare("PRAGMA table_info(sessions)").all<{ name: string }>();
    expect(results.map((c) => c.name)).toContain("reauth_at");
  });

  it("deleting a user cascades to every MFA table", async () => {
    const { userId } = await createUserWithSession();
    const session = await db
      .prepare("SELECT id FROM sessions WHERE user_id = ?")
      .bind(userId)
      .first<{ id: string }>();
    await seed(userId, session?.id ?? "");
    for (const t of MFA_TABLES) expect(await count(t)).toBe(1);
    await db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
    for (const t of MFA_TABLES) expect(await count(t)).toBe(0);
  });

  it("rejects an unknown challenge purpose and ticket client", async () => {
    const { userId } = await createUserWithSession();
    const now = Date.now();
    await expect(
      db
        .prepare(
          "INSERT INTO webauthn_challenges (id, user_id, purpose, created_at, expires_at) VALUES ('x', ?, 'x', ?, ?)",
        )
        .bind(userId, now, now)
        .run(),
    ).rejects.toThrow();
    await expect(
      db
        .prepare(
          "INSERT INTO mfa_tickets (id, user_id, client, created_at, expires_at) VALUES ('x', ?, 'tv', ?, ?)",
        )
        .bind(userId, now, now)
        .run(),
    ).rejects.toThrow();
  });
});

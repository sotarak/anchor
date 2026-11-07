import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createGrant, issueCode, issueTokenPair, registerClient } from "#src/oauth/store";
import { createUserWithSession, listAppTables, resetDb } from "#test/support";

const db = env.DB;

beforeEach(resetDb);

const count = async (table: string) =>
  (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n;

describe("migration 0008", () => {
  it("creates the OAuth tables", async () => {
    expect(await listAppTables()).toEqual(
      expect.arrayContaining(["oauth_clients", "oauth_grants", "oauth_codes", "oauth_tokens"]),
    );
  });

  it("deleting a user cascades grants, codes and tokens", async () => {
    const { userId } = await createUserWithSession();
    const now = Date.now();
    const client = await registerClient(db, {
      name: "x",
      redirectUris: ["https://a.example/cb"],
      ip: null,
      now,
    });
    const grantId = await createGrant(db, {
      userId,
      clientId: client.id,
      scopes: ["secrets:read"],
      now,
    });
    await issueCode(db, { grantId, redirectUri: "https://a.example/cb", codeChallenge: "c", now });
    await issueTokenPair(db, grantId, now);
    await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
    await db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
    expect([
      await count("oauth_grants"),
      await count("oauth_codes"),
      await count("oauth_tokens"),
    ]).toEqual([0, 0, 0]);
    expect(await count("oauth_clients")).toBe(1);
  });

  it("rejects a token kind other than access or refresh", async () => {
    await expect(
      db
        .prepare(
          "INSERT INTO oauth_tokens (id, grant_id, kind, created_at, expires_at) VALUES ('x', 'g', 'code', 0, 0)",
        )
        .run(),
    ).rejects.toThrow();
  });
});

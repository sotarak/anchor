import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { CHALLENGE_TTL_MS, storeChallenge, takeChallenge } from "#src/mfa/challenges";
import { createMfaTicket, findMfaTicket } from "#src/mfa/tickets";
import { createUserWithSession, resetDb } from "#test/support";

const db = env.DB;
let userId: string;
let sessionId: string;
let ticketId: string;

beforeEach(async () => {
  await resetDb();
  ({ userId } = await createUserWithSession());
  sessionId =
    (
      await db
        .prepare("SELECT id FROM sessions WHERE user_id = ?")
        .bind(userId)
        .first<{ id: string }>()
    )?.id ?? "";
  const now = Date.now();
  const { ticket } = await createMfaTicket(db, userId, "web", now);
  ticketId = (await findMfaTicket(db, ticket, now))?.id ?? "";
});

describe("WebAuthn challenges", () => {
  it("is taken once, then gone", async () => {
    const now = Date.now();
    const owner = { purpose: "login", ticketId } as const;
    await storeChallenge(db, userId, owner, "ch-1", now);
    expect(await takeChallenge(db, userId, owner, now)).toBe("ch-1");
    expect(await takeChallenge(db, userId, owner, now)).toBeNull();
  });

  it("expires after 5 minutes", async () => {
    const now = Date.now();
    const owner = { purpose: "reauth", sessionId } as const;
    await storeChallenge(db, userId, owner, "ch-2", now);
    expect(CHALLENGE_TTL_MS).toBe(300_000);
    expect(await takeChallenge(db, userId, owner, now + CHALLENGE_TTL_MS)).toBeNull();
  });

  it("a new challenge replaces the owner's earlier one", async () => {
    const now = Date.now();
    const owner = { purpose: "register", sessionId } as const;
    await storeChallenge(db, userId, owner, "old", now);
    await storeChallenge(db, userId, owner, "new", now);
    expect(await takeChallenge(db, userId, owner, now)).toBe("new");
  });

  it("another owner, purpose or user cannot take it", async () => {
    const now = Date.now();
    await storeChallenge(db, userId, { purpose: "register", sessionId }, "mine", now);
    expect(await takeChallenge(db, userId, { purpose: "reauth", sessionId }, now)).toBeNull();
    expect(await takeChallenge(db, userId, { purpose: "login", ticketId }, now)).toBeNull();
    expect(
      await takeChallenge(db, "someone-else", { purpose: "register", sessionId }, now),
    ).toBeNull();
    expect(await takeChallenge(db, userId, { purpose: "register", sessionId }, now)).toBe("mine");
  });
});

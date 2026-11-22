import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeMfaTicket,
  createMfaTicket,
  deleteUserMfaTickets,
  findMfaTicket,
  MAX_TICKET_FAILURES,
  MFA_TICKET_TTL_MS,
  recordTicketFailure,
} from "#src/mfa/tickets";
import { createUserWithSession, resetDb } from "#test/support";

const db = env.DB;
let userId: string;
let sessionToken: string;

beforeEach(async () => {
  await resetDb();
  ({ userId, token: sessionToken } = await createUserWithSession());
});

describe("MFA tickets", () => {
  it("issues an anc_mfa_ ticket for 5 minutes, stored only as its hash", async () => {
    const now = Date.now();
    const { ticket, expiresAt } = await createMfaTicket(db, userId, "cli", now);
    expect(ticket).toMatch(/^anc_mfa_[A-Za-z0-9_-]{43}$/);
    expect(expiresAt).toBe(now + MFA_TICKET_TTL_MS);
    expect(MFA_TICKET_TTL_MS).toBe(300_000);
    const dump = JSON.stringify((await db.prepare("SELECT * FROM mfa_tickets").all()).results);
    expect(dump).not.toContain(ticket);
    expect(await findMfaTicket(db, ticket, now)).toMatchObject({ userId, client: "cli" });
  });

  it("an expired ticket, a session token and garbage are not tickets", async () => {
    const now = Date.now();
    const { ticket } = await createMfaTicket(db, userId, "web", now);
    expect(await findMfaTicket(db, ticket, now + MFA_TICKET_TTL_MS)).toBeNull();
    expect(await findMfaTicket(db, sessionToken, now)).toBeNull();
    expect(await findMfaTicket(db, "anc_mfa_nope", now)).toBeNull();
  });

  it("the fifth failure deletes the ticket", async () => {
    const now = Date.now();
    const { ticket } = await createMfaTicket(db, userId, "web", now);
    const t = await findMfaTicket(db, ticket, now);
    if (!t) throw new Error("no ticket");
    expect(MAX_TICKET_FAILURES).toBe(5);
    for (let i = 0; i < 4; i++) await recordTicketFailure(db, t.id);
    expect(await findMfaTicket(db, ticket, now)).not.toBeNull();
    await recordTicketFailure(db, t.id);
    expect(await findMfaTicket(db, ticket, now)).toBeNull();
  });

  it("a ticket is consumed once", async () => {
    const now = Date.now();
    const { ticket } = await createMfaTicket(db, userId, "web", now);
    const t = await findMfaTicket(db, ticket, now);
    if (!t) throw new Error("no ticket");
    expect(await consumeMfaTicket(db, t.id, now)).toBe(true);
    expect(await consumeMfaTicket(db, t.id, now)).toBe(false);
    expect(await findMfaTicket(db, ticket, now)).toBeNull();
  });

  it("deleteUserMfaTickets drops every pending login of the user", async () => {
    const now = Date.now();
    const a = await createMfaTicket(db, userId, "web", now);
    const b = await createMfaTicket(db, userId, "cli", now);
    await deleteUserMfaTickets(db, userId);
    expect(await findMfaTicket(db, a.ticket, now)).toBeNull();
    expect(await findMfaTicket(db, b.ticket, now)).toBeNull();
  });
});

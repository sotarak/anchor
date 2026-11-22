import { newToken, sha256Hex } from "../lib/random";

/**
 * A password login waiting for its second factor (spec 2026-11-22-v0.6.0-mfa). The ticket is a
 * bearer secret for one login only: it is never a session, lives 5 minutes, dies after 5 wrong
 * factors, and only its SHA-256 is stored.
 */
export const MFA_TICKET_TTL_MS = 300_000;
export const MAX_TICKET_FAILURES = 5;
const PREFIX = "anc_mfa_";

export type MfaTicket = { id: string; userId: string; client: "web" | "cli" };

export async function createMfaTicket(
  db: D1Database,
  userId: string,
  client: "web" | "cli",
  now: number,
): Promise<{ ticket: string; expiresAt: number }> {
  const ticket = newToken("anc_mfa");
  const expiresAt = now + MFA_TICKET_TTL_MS;
  await db
    .prepare(
      "INSERT INTO mfa_tickets (id, user_id, client, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(await sha256Hex(ticket), userId, client, now, expiresAt)
    .run();
  return { ticket, expiresAt };
}

export async function findMfaTicket(
  db: D1Database,
  ticket: string,
  now: number,
): Promise<MfaTicket | null> {
  if (!ticket.startsWith(PREFIX)) return null;
  const row = await db
    .prepare("SELECT id, user_id, client FROM mfa_tickets WHERE id = ? AND expires_at > ?")
    .bind(await sha256Hex(ticket), now)
    .first<{ id: string; user_id: string; client: "web" | "cli" }>();
  return row ? { id: row.id, userId: row.user_id, client: row.client } : null;
}

/** Counts a wrong factor; the MAX_TICKET_FAILURES-th one deletes the ticket. */
export async function recordTicketFailure(db: D1Database, ticketId: string): Promise<void> {
  await db.batch([
    db.prepare("UPDATE mfa_tickets SET failures = failures + 1 WHERE id = ?").bind(ticketId),
    db
      .prepare("DELETE FROM mfa_tickets WHERE id = ? AND failures >= ?")
      .bind(ticketId, MAX_TICKET_FAILURES),
  ]);
}

/** Deletes the ticket; false when it was already used, expired or deleted (a lost race). */
export async function consumeMfaTicket(
  db: D1Database,
  ticketId: string,
  now: number,
): Promise<boolean> {
  const row = await db
    .prepare("DELETE FROM mfa_tickets WHERE id = ? AND expires_at > ? RETURNING id")
    .bind(ticketId, now)
    .first();
  return row !== null;
}

/** A password change or reset, or Reset 2FA, ends every pending login of the user. */
export async function deleteUserMfaTickets(db: D1Database, userId: string): Promise<void> {
  await db.prepare("DELETE FROM mfa_tickets WHERE user_id = ?").bind(userId).run();
}

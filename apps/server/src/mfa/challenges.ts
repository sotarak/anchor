/**
 * Outstanding WebAuthn challenges: single use, 5 minutes, owned by a login ticket or a dashboard
 * session and a purpose, so a challenge issued for one flow cannot answer another.
 */
export const CHALLENGE_TTL_MS = 300_000;

export type ChallengeOwner =
  | { purpose: "login"; ticketId: string }
  | { purpose: "register" | "reauth"; sessionId: string };

function ownerColumns(owner: ChallengeOwner): [string | null, string | null] {
  return owner.purpose === "login" ? [owner.ticketId, null] : [null, owner.sessionId];
}

const SAME_OWNER = `user_id = ?1 AND purpose = ?2
  AND ticket_id IS ?3 AND session_id IS ?4`;

/** Stores the challenge, replacing the owner's earlier one. */
export async function storeChallenge(
  db: D1Database,
  userId: string,
  owner: ChallengeOwner,
  challenge: string,
  now: number,
): Promise<void> {
  const [ticketId, sessionId] = ownerColumns(owner);
  await db.batch([
    db
      .prepare(`DELETE FROM webauthn_challenges WHERE ${SAME_OWNER}`)
      .bind(userId, owner.purpose, ticketId, sessionId),
    db
      .prepare(
        `INSERT INTO webauthn_challenges (id, user_id, purpose, ticket_id, session_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(challenge, userId, owner.purpose, ticketId, sessionId, now, now + CHALLENGE_TTL_MS),
  ]);
}

/** Removes and returns the owner's live challenge, or null. */
export async function takeChallenge(
  db: D1Database,
  userId: string,
  owner: ChallengeOwner,
  now: number,
): Promise<string | null> {
  const [ticketId, sessionId] = ownerColumns(owner);
  const row = await db
    .prepare(`DELETE FROM webauthn_challenges WHERE ${SAME_OWNER} RETURNING id, expires_at`)
    .bind(userId, owner.purpose, ticketId, sessionId)
    .first<{ id: string; expires_at: number }>();
  return row && row.expires_at > now ? row.id : null;
}

import type { InstanceRole, UserDto } from "@anchor/shared";
import { newId } from "../lib/random";

export type UserRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: InstanceRole;
  failed_logins: number;
  locked_until: number | null;
  disabled_at: number | null;
};

const COLUMNS = "id, email, name, password_hash, role, failed_logins, locked_until, disabled_at";

export function findUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db.prepare(`SELECT ${COLUMNS} FROM users WHERE email = ?`).bind(email).first<UserRow>();
}

export function findUserById(db: D1Database, id: string): Promise<UserRow | null> {
  return db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).bind(id).first<UserRow>();
}

export async function insertUser(
  db: D1Database,
  u: { email: string; name: string; passwordHash: string; role: InstanceRole },
  now: number,
): Promise<string> {
  const id = newId();
  await db
    .prepare(
      "INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, u.email, u.name, u.passwordHash, u.role, now, now)
    .run();
  return id;
}

/** Inserts the first owner only while the users table is empty. Returns null otherwise. */
export async function insertFirstOwner(
  db: D1Database,
  u: { email: string; name: string; passwordHash: string },
  now: number,
): Promise<string | null> {
  const id = newId();
  const result = await db
    .prepare(
      `INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
       SELECT ?, ?, ?, ?, 'owner', ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)`,
    )
    .bind(id, u.email, u.name, u.passwordHash, now, now)
    .run();
  return result.meta.changes === 1 ? id : null;
}

/**
 * Atomically counts one login attempt against the account before the password is checked, so
 * parallel requests cannot all read the same failure count. The 5th attempt sets the lock in the
 * same statement. Returns false when the account is locked (no attempt is counted). A successful
 * login then resets the state with updateLoginState. Mirrors nextLockState in auth/lockout.ts.
 */
export async function reserveLoginAttempt(
  db: D1Database,
  userId: string,
  now: number,
  limits: { maxFailures: number; lockoutMs: number },
): Promise<boolean> {
  const row = await db
    .prepare(
      `UPDATE users SET
         failed_logins = CASE WHEN failed_logins + 1 >= ?1 THEN 0 ELSE failed_logins + 1 END,
         locked_until = CASE WHEN failed_logins + 1 >= ?1 THEN ?2 ELSE NULL END
       WHERE id = ?3 AND (locked_until IS NULL OR locked_until <= ?4)
       RETURNING id`,
    )
    .bind(limits.maxFailures, now + limits.lockoutMs, userId, now)
    .first<{ id: string }>();
  return row !== null;
}

/** Sets a new password hash and clears lockout state. */
export async function setPassword(
  db: D1Database,
  userId: string,
  passwordHash: string,
  now: number,
): Promise<void> {
  await db
    .prepare(
      "UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?",
    )
    .bind(passwordHash, now, userId)
    .run();
}

export async function updateLoginState(
  db: D1Database,
  userId: string,
  s: { failedLogins: number; lockedUntil: number | null },
): Promise<void> {
  await db
    .prepare("UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?")
    .bind(s.failedLogins, s.lockedUntil, userId)
    .run();
}

/** disabledAt is included only when the caller has it (a full row); principals omit it. */
export function toUserDto(
  u: Pick<UserRow, "id" | "email" | "name" | "role"> & { disabled_at?: number | null },
): UserDto {
  const dto: UserDto = { id: u.id, email: u.email, name: u.name, role: u.role };
  if (u.disabled_at !== undefined) dto.disabledAt = u.disabled_at;
  return dto;
}

export async function listUsers(db: D1Database): Promise<UserRow[]> {
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} FROM users ORDER BY email`)
    .all<UserRow>();
  return results;
}

/** True unless the row is an active owner and no other active owner exists (SQL fragment). */
const KEEPS_AN_ACTIVE_OWNER = `(NOT (role = 'owner' AND disabled_at IS NULL)
  OR (SELECT count(*) FROM users o WHERE o.role = 'owner' AND o.disabled_at IS NULL AND o.id != users.id) > 0)`;

/**
 * Applies the patch in one conditional UPDATE. Refuses ("last_owner") when the target is the
 * only active owner and the patch would demote or disable them.
 */
export async function updateUserGuarded(
  db: D1Database,
  targetId: string,
  patch: { role?: InstanceRole; disabledAt?: number | null },
  now: number,
  actor: { actorIsOwner: boolean },
): Promise<"ok" | "last_owner" | "not_found" | "forbidden"> {
  const setDisabled = patch.disabledAt !== undefined ? 1 : 0;
  const result = await db
    .prepare(
      `UPDATE users
       SET role = COALESCE(?1, role),
           disabled_at = CASE WHEN ?2 = 1 THEN ?3 ELSE disabled_at END,
           updated_at = ?4
       WHERE id = ?5 AND (
         (COALESCE(?1, role) = 'owner' AND (CASE WHEN ?2 = 1 THEN ?3 ELSE disabled_at END) IS NULL)
         OR ${KEEPS_AN_ACTIVE_OWNER}
       )
         AND (?6 = 1 OR (role != 'owner' AND COALESCE(?1, role) != 'owner'))`,
    )
    .bind(
      patch.role ?? null,
      setDisabled,
      patch.disabledAt ?? null,
      now,
      targetId,
      actor.actorIsOwner ? 1 : 0,
    )
    .run();
  if (result.meta.changes === 1) return "ok";
  const row = await findUserById(db, targetId);
  if (!row) return "not_found";
  if (!actor.actorIsOwner && (row.role === "owner" || patch.role === "owner")) return "forbidden";
  return "last_owner";
}

/** Deletes the user (sessions and memberships cascade) unless they are the last active owner. */
export async function deleteUserGuarded(
  db: D1Database,
  targetId: string,
  actor: { actorIsOwner: boolean },
): Promise<"ok" | "last_owner" | "not_found" | "forbidden"> {
  const result = await db
    // RETURNING, not meta.changes: D1 counts the cascaded sessions/memberships as changes.
    .prepare(
      `DELETE FROM users WHERE id = ? AND ${KEEPS_AN_ACTIVE_OWNER}
         AND (? = 1 OR role != 'owner') RETURNING id`,
    )
    .bind(targetId, actor.actorIsOwner ? 1 : 0)
    .first<{ id: string }>();
  if (result) return "ok";
  const row = await findUserById(db, targetId);
  if (!row) return "not_found";
  return !actor.actorIsOwner && row.role === "owner" ? "forbidden" : "last_owner";
}

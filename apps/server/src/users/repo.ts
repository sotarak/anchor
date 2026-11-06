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
};

const COLUMNS = "id, email, name, password_hash, role, failed_logins, locked_until";

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

export function toUserDto(u: Pick<UserRow, "id" | "email" | "name" | "role">): UserDto {
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

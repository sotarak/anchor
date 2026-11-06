export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 900_000;

export type LockState = { failedLogins: number; lockedUntil: number | null };

export function isLocked(s: LockState, now: number): boolean {
  return s.lockedUntil !== null && now < s.lockedUntil;
}

export function nextLockState(
  s: LockState,
  outcome: "success" | "failure",
  now: number,
): LockState {
  if (outcome === "success") return { failedLogins: 0, lockedUntil: null };
  const failedLogins = s.failedLogins + 1;
  if (failedLogins >= MAX_FAILED_LOGINS) return { failedLogins: 0, lockedUntil: now + LOCKOUT_MS };
  return { failedLogins, lockedUntil: isLocked(s, now) ? s.lockedUntil : null };
}

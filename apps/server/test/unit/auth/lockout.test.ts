import { describe, expect, it } from "vitest";
import {
  isLocked,
  LOCKOUT_MS,
  type LockState,
  MAX_FAILED_LOGINS,
  nextLockState,
} from "#src/auth/lockout";

const now = 1_000_000;
const fresh: LockState = { failedLogins: 0, lockedUntil: null };

describe("lockout state machine", () => {
  it("constants match the spec", () => {
    expect(MAX_FAILED_LOGINS).toBe(5);
    expect(LOCKOUT_MS).toBe(900_000);
  });

  it("4 failures do not lock; the 5th locks until now + 900000", () => {
    let s = fresh;
    for (let i = 0; i < 4; i++) s = nextLockState(s, "failure", now);
    expect(s).toEqual({ failedLogins: 4, lockedUntil: null });
    expect(isLocked(s, now)).toBe(false);
    s = nextLockState(s, "failure", now);
    expect(s).toEqual({ failedLogins: 0, lockedUntil: now + 900_000 });
  });

  it("is locked at now + 899999 and unlocked at now + 900000", () => {
    const s: LockState = { failedLogins: 0, lockedUntil: now + 900_000 };
    expect(isLocked(s, now + 899_999)).toBe(true);
    expect(isLocked(s, now + 900_000)).toBe(false);
  });

  it("success resets the count and lock", () => {
    expect(nextLockState({ failedLogins: 3, lockedUntil: null }, "success", now)).toEqual(fresh);
    expect(nextLockState({ failedLogins: 0, lockedUntil: now - 1 }, "success", now)).toEqual(fresh);
  });
});

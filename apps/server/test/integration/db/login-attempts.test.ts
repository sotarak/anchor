import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLoginLocksForEmail,
  LOGIN_WINDOW_MS,
  loginAttemptKeys,
  purgeLoginAttempts,
  reserveLoginKeys,
} from "#src/auth/login-attempts";
import { resetDb } from "#test/support";

const db = env.DB;
const DAY = 86_400_000;
beforeEach(resetDb);

const keys = (rows: { key: string }[]) => rows.map((r) => r.key).sort();
const all = async () =>
  (await db.prepare("SELECT key FROM login_attempts").all<{ key: string }>()).results;

describe("loginAttemptKeys", () => {
  it("counts a pair and an address; IPv6 by /64; no address key without an address", () => {
    expect(loginAttemptKeys("198.51.100.7", "a@x.io")).toEqual([
      { key: "p|198.51.100.7|a@x.io", max: 5 },
      { key: "i|198.51.100.7", max: 50 },
    ]);
    expect(loginAttemptKeys("2001:db8::1", "a@x.io")[0]?.key).toBe("p|2001:db8:0:0::/64|a@x.io");
    expect(loginAttemptKeys(null, "a@x.io")).toEqual([{ key: "p|-|a@x.io", max: 5 }]);
  });
});

describe("purgeLoginAttempts", () => {
  it("deletes windows older than a day whose lock has ended, keeps a live lock", async () => {
    const now = Date.now();
    const stale = loginAttemptKeys("198.51.100.1", "old@x.io");
    const locked = loginAttemptKeys("198.51.100.2", "locked@x.io");
    const fresh = loginAttemptKeys("198.51.100.3", "new@x.io");
    await reserveLoginKeys(db, stale, now - 2 * DAY);
    for (let i = 0; i < 5; i++) await reserveLoginKeys(db, locked, now - 2 * DAY);
    await db
      .prepare("UPDATE login_attempts SET locked_until = ? WHERE key = ?")
      .bind(now + LOGIN_WINDOW_MS, locked[0]?.key)
      .run();
    await reserveLoginKeys(db, fresh, now);
    expect(await purgeLoginAttempts(db, now)).toBe(3);
    expect(keys(await all())).toEqual([
      "i|198.51.100.3",
      "p|198.51.100.2|locked@x.io",
      "p|198.51.100.3|new@x.io",
    ]);
  });
});

describe("clearLoginLocksForEmail", () => {
  it("removes that email's pairs from every address and nothing else", async () => {
    const now = Date.now();
    await reserveLoginKeys(db, loginAttemptKeys("198.51.100.1", "a@x.io"), now);
    await reserveLoginKeys(db, loginAttemptKeys("198.51.100.2", "a@x.io"), now);
    await reserveLoginKeys(db, loginAttemptKeys("198.51.100.1", "b@x.io"), now);
    await clearLoginLocksForEmail(db, "a@x.io");
    expect(keys(await all())).toEqual([
      "i|198.51.100.1",
      "i|198.51.100.2",
      "p|198.51.100.1|b@x.io",
    ]);
  });
});

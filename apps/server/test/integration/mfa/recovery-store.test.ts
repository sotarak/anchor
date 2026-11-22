import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeRecoveryCode,
  countRecoveryCodes,
  deleteRecoveryCodes,
  replaceRecoveryCodes,
} from "#src/mfa/recovery-store";
import { createUserWithSession, resetDb } from "#test/support";

const db = env.DB;
let userId: string;

beforeEach(async () => {
  await resetDb();
  ({ userId } = await createUserWithSession());
});

describe("recovery code store", () => {
  it("stores only hashes", async () => {
    const codes = await replaceRecoveryCodes(db, userId, Date.now());
    const dump = JSON.stringify((await db.prepare("SELECT * FROM recovery_codes").all()).results);
    for (const c of codes) {
      expect(dump).not.toContain(c);
      expect(dump).not.toContain(c.replace("-", ""));
    }
  });

  it("a code works once, typed loosely; the count drops by one", async () => {
    const [code] = await replaceRecoveryCodes(db, userId, Date.now());
    if (!code) throw new Error("no code");
    const loose = ` ${code.toUpperCase().replace("-", " ")} `;
    expect(await consumeRecoveryCode(db, userId, loose, Date.now())).toBe(true);
    expect(await countRecoveryCodes(db, userId)).toBe(9);
    expect(await consumeRecoveryCode(db, userId, code, Date.now())).toBe(false);
  });

  it("another user's code and malformed input are refused", async () => {
    const [code] = await replaceRecoveryCodes(db, userId, Date.now());
    const { userId: other } = await createUserWithSession();
    await replaceRecoveryCodes(db, other, Date.now());
    expect(await consumeRecoveryCode(db, other, code ?? "", Date.now())).toBe(false);
    expect(await consumeRecoveryCode(db, userId, "nope", Date.now())).toBe(false);
    expect(await countRecoveryCodes(db, userId)).toBe(10);
  });

  it("replacing invalidates the previous set; deleting removes all", async () => {
    const old = await replaceRecoveryCodes(db, userId, Date.now());
    const fresh = await replaceRecoveryCodes(db, userId, Date.now());
    expect(await consumeRecoveryCode(db, userId, old[0] ?? "", Date.now())).toBe(false);
    expect(await consumeRecoveryCode(db, userId, fresh[0] ?? "", Date.now())).toBe(true);
    await deleteRecoveryCodes(db, userId);
    expect(await countRecoveryCodes(db, userId)).toBe(0);
  });
});

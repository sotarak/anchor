import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  deletePasskey,
  findPasskey,
  insertPasskey,
  listPasskeys,
  MAX_PASSKEYS,
  toPasskeyDto,
  touchPasskey,
} from "#src/mfa/passkey-store";
import type { NewPasskey } from "#src/mfa/webauthn";
import { createUserWithSession, resetDb } from "#test/support";

const db = env.DB;
let userId: string;
const key = (id: string): NewPasskey => ({
  id,
  publicKey: new Uint8Array([1, 2, 3]),
  counter: 0,
  transports: ["internal"],
  backedUp: true,
});

beforeEach(async () => {
  await resetDb();
  ({ userId } = await createUserWithSession());
});

describe("passkey store", () => {
  it("inserts, finds and lists a passkey with its relying party", async () => {
    const now = Date.now();
    expect(await insertPasskey(db, userId, "anchor.test", "Laptop", key("c1"), now)).toBe("ok");
    const row = await findPasskey(db, userId, "c1");
    expect(row).toMatchObject({
      id: "c1",
      rpId: "anchor.test",
      name: "Laptop",
      counter: 0,
      transports: ["internal"],
      backedUp: true,
      lastUsedAt: null,
    });
    expect(row?.publicKey).toEqual(new Uint8Array([1, 2, 3]));
    expect((await listPasskeys(db, userId)).map((p) => p.id)).toEqual(["c1"]);
  });

  it("caps at 20 passkeys and refuses a duplicate credential id", async () => {
    expect(MAX_PASSKEYS).toBe(20);
    for (let i = 0; i < 20; i++) {
      expect(await insertPasskey(db, userId, "anchor.test", `k${i}`, key(`c${i}`), i)).toBe("ok");
    }
    expect(await insertPasskey(db, userId, "anchor.test", "k20", key("c20"), 20)).toBe("limit");
    const { userId: other } = await createUserWithSession();
    expect(await insertPasskey(db, other, "anchor.test", "dup", key("c0"), 0)).toBe("duplicate");
  });

  it("never finds or deletes another user's passkey", async () => {
    await insertPasskey(db, userId, "anchor.test", "Mine", key("c1"), 0);
    const { userId: other } = await createUserWithSession();
    expect(await findPasskey(db, other, "c1")).toBeNull();
    expect(await deletePasskey(db, other, "c1")).toBe(false);
    expect(await deletePasskey(db, userId, "c1")).toBe(true);
    expect(await listPasskeys(db, userId)).toEqual([]);
  });

  it("touch records the new counter and the use time", async () => {
    await insertPasskey(db, userId, "anchor.test", "Mine", key("c1"), 0);
    await touchPasskey(db, "c1", 7, 1234);
    expect(await findPasskey(db, userId, "c1")).toMatchObject({ counter: 7, lastUsedAt: 1234 });
  });

  it("the DTO says whether it works on this hostname", async () => {
    await insertPasskey(db, userId, "anchor.test", "Mine", key("c1"), 5);
    const row = await findPasskey(db, userId, "c1");
    if (!row) throw new Error("no row");
    expect(toPasskeyDto(row, "anchor.test")).toEqual({
      id: "c1",
      name: "Mine",
      rpId: "anchor.test",
      usableHere: true,
      backedUp: true,
      createdAt: 5,
      lastUsedAt: null,
    });
    expect(toPasskeyDto(row, "other.example").usableHere).toBe(false);
  });
});

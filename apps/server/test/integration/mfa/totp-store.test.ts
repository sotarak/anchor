import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { getRootKeyring } from "#src/crypto/keyring";
import { toHex } from "#src/lib/encoding";
import { IntegrityError } from "#src/lib/errors";
import { hotp, timeStep } from "#src/mfa/totp";
import {
  confirmTotp,
  consumeTotpCode,
  deleteTotp,
  hasConfirmedTotp,
  startTotpEnrollment,
} from "#src/mfa/totp-store";
import { createUserWithSession, resetDb } from "#test/support";

const db = env.DB;
let userId: string;
const keyring = () => getRootKeyring(env);
const codeAt = (secret: Uint8Array, nowMs: number) => hotp(secret, timeStep(nowMs));

async function enrolled(now = Date.now()) {
  const secret = await startTotpEnrollment(db, await keyring(), userId, now);
  if (!secret) throw new Error("enrollment refused");
  expect(await confirmTotp(db, await keyring(), userId, await codeAt(secret, now), now)).toBe(true);
  return secret;
}

beforeEach(async () => {
  await resetDb();
  ({ userId } = await createUserWithSession());
});

describe("TOTP store", () => {
  it("seals the secret: the row never contains its bytes", async () => {
    const secret = await startTotpEnrollment(db, await keyring(), userId, Date.now());
    if (!secret) throw new Error("no secret");
    const row = await db.prepare("SELECT * FROM totp_credentials").first();
    expect(toHex(new Uint8Array(row?.secret_ct as number[]))).not.toContain(toHex(secret));
    expect(row?.root_key_id).toBe("rk-test");
  });

  it("an unconfirmed secret does not log anyone in, and confirming needs the right code", async () => {
    const now = Date.now();
    const secret = await startTotpEnrollment(db, await keyring(), userId, now);
    if (!secret) throw new Error("no secret");
    expect(await consumeTotpCode(db, await keyring(), userId, await codeAt(secret, now), now)).toBe(
      false,
    );
    expect(await hasConfirmedTotp(db, userId)).toBe(false);
    expect(await confirmTotp(db, await keyring(), userId, "000000", now)).toBe(false);
    expect(await confirmTotp(db, await keyring(), userId, await codeAt(secret, now), now)).toBe(
      true,
    );
    expect(await hasConfirmedTotp(db, userId)).toBe(true);
  });

  it("enrollment restarts while unconfirmed and is refused once confirmed", async () => {
    const a = await startTotpEnrollment(db, await keyring(), userId, Date.now());
    const b = await startTotpEnrollment(db, await keyring(), userId, Date.now());
    expect(a).not.toEqual(b);
    await enrolled();
    expect(await startTotpEnrollment(db, await keyring(), userId, Date.now())).toBeNull();
  });

  it("a code works once; an earlier step's code is refused after a later one (no replay)", async () => {
    const t0 = Date.now() + 120_000; // a step after the confirming one
    const secret = await enrolled();
    expect(await consumeTotpCode(db, await keyring(), userId, await codeAt(secret, t0), t0)).toBe(
      true,
    );
    expect(await consumeTotpCode(db, await keyring(), userId, await codeAt(secret, t0), t0)).toBe(
      false,
    );
    const previous = await hotp(secret, timeStep(t0) - 1);
    expect(await consumeTotpCode(db, await keyring(), userId, previous, t0)).toBe(false);
  });

  it("two concurrent uses of the same code: exactly one succeeds", async () => {
    const t = Date.now() + 120_000;
    const secret = await enrolled();
    const code = await codeAt(secret, t);
    const results = await Promise.all([
      consumeTotpCode(db, await keyring(), userId, code, t),
      consumeTotpCode(db, await keyring(), userId, code, t),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("a row copied to another user fails closed with IntegrityError (AAD binds the user)", async () => {
    await enrolled();
    const { userId: other } = await createUserWithSession();
    await db
      .prepare(
        `INSERT INTO totp_credentials (user_id, root_key_id, iv, secret_ct, confirmed_at, created_at)
         SELECT ?, root_key_id, iv, secret_ct, confirmed_at, created_at FROM totp_credentials WHERE user_id = ?`,
      )
      .bind(other, userId)
      .run();
    await expect(consumeTotpCode(db, await keyring(), other, "123456", Date.now())).rejects.toThrow(
      IntegrityError,
    );
  });

  it("a flipped ciphertext bit fails closed with IntegrityError", async () => {
    await enrolled();
    const row = await db
      .prepare("SELECT secret_ct FROM totp_credentials")
      .first<{ secret_ct: number[] }>();
    const ct = Uint8Array.from(row?.secret_ct ?? []);
    ct[0] = (ct[0] ?? 0) ^ 1;
    await db.prepare("UPDATE totp_credentials SET secret_ct = ?").bind(ct).run();
    await expect(
      consumeTotpCode(db, await keyring(), userId, "123456", Date.now()),
    ).rejects.toThrow(IntegrityError);
  });

  it("malformed codes are refused without touching the row", async () => {
    await enrolled();
    expect(await consumeTotpCode(db, await keyring(), userId, "12345", Date.now())).toBe(false);
  });

  it("deleteTotp removes it", async () => {
    await enrolled();
    expect(await deleteTotp(db, userId)).toBe(true);
    expect(await hasConfirmedTotp(db, userId)).toBe(false);
    expect(await deleteTotp(db, userId)).toBe(false);
  });
});

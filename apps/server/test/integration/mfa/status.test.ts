import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { getRootKeyring } from "#src/crypto/keyring";
import { CHALLENGE_TTL_MS, storeChallenge } from "#src/mfa/challenges";
import { insertPasskey } from "#src/mfa/passkey-store";
import { countRecoveryCodes, replaceRecoveryCodes } from "#src/mfa/recovery-store";
import {
  afterFactorRemoved,
  hasMfa,
  loginMethods,
  mfaStatus,
  purgeMfa,
  resetUserMfa,
} from "#src/mfa/status";
import { createMfaTicket, findMfaTicket, MFA_TICKET_TTL_MS } from "#src/mfa/tickets";
import { hotp, timeStep } from "#src/mfa/totp";
import { confirmTotp, deleteTotp, startTotpEnrollment } from "#src/mfa/totp-store";
import { createUserWithSession, resetDb } from "#test/support";

const db = env.DB;
let userId: string;
const passkey = (id: string) => ({
  id,
  publicKey: new Uint8Array([1]),
  counter: 0,
  transports: null,
  backedUp: false,
});

async function enableTotp() {
  const now = Date.now();
  const keyring = await getRootKeyring(env);
  const secret = await startTotpEnrollment(db, keyring, userId, now);
  if (!secret) throw new Error("no secret");
  await confirmTotp(db, keyring, userId, await hotp(secret, timeStep(now)), now);
}

beforeEach(async () => {
  await resetDb();
  ({ userId } = await createUserWithSession());
});

describe("MFA status", () => {
  it("has no MFA with only a pending TOTP or only recovery codes", async () => {
    expect(await hasMfa(db, userId)).toBe(false);
    await startTotpEnrollment(db, await getRootKeyring(env), userId, Date.now());
    await replaceRecoveryCodes(db, userId, Date.now());
    expect(await hasMfa(db, userId)).toBe(false);
  });

  it("login methods list totp, a passkey usable on this host, then recovery", async () => {
    await enableTotp();
    expect(await loginMethods(db, userId, "anchor.test")).toEqual(["totp", "recovery"]);
    await insertPasskey(db, userId, "anchor.test", "Mine", passkey("c1"), 0);
    expect(await loginMethods(db, userId, "anchor.test")).toEqual(["totp", "passkey", "recovery"]);
  });

  it("a passkey from another hostname is not offered", async () => {
    await insertPasskey(db, userId, "anchor.test", "Mine", passkey("c1"), 0);
    expect(await hasMfa(db, userId)).toBe(true);
    expect(await loginMethods(db, userId, "other.example")).toEqual(["recovery"]);
  });

  it("removing one of two factors keeps the recovery codes; the last one removes them", async () => {
    await enableTotp();
    await insertPasskey(db, userId, "anchor.test", "Mine", passkey("c1"), 0);
    await replaceRecoveryCodes(db, userId, Date.now());
    await deleteTotp(db, userId);
    await afterFactorRemoved(db, userId);
    expect(await countRecoveryCodes(db, userId)).toBe(10);
    await db.prepare("DELETE FROM webauthn_credentials").run();
    await afterFactorRemoved(db, userId);
    expect(await countRecoveryCodes(db, userId)).toBe(0);
  });

  it("status reports factors, codes and the step-up window", async () => {
    const now = Date.now();
    await enableTotp();
    await insertPasskey(db, userId, "other.example", "Elsewhere", passkey("c1"), 0);
    await replaceRecoveryCodes(db, userId, now);
    const status = await mfaStatus(db, userId, "anchor.test", now - 1000, now);
    expect(status).toMatchObject({ enabled: true, totp: true, recoveryCodesRemaining: 10 });
    expect(status.passkeys).toEqual([
      expect.objectContaining({ id: "c1", usableHere: false, rpId: "other.example" }),
    ]);
    expect(status.reauthUntil).toBe(now - 1000 + 600_000);
    expect((await mfaStatus(db, userId, "anchor.test", now - 600_000, now)).reauthUntil).toBeNull();
    expect((await mfaStatus(db, userId, "anchor.test", null, now)).reauthUntil).toBeNull();
  });

  it("reset removes every factor, code, ticket and the factor lock", async () => {
    const now = Date.now();
    await enableTotp();
    await insertPasskey(db, userId, "anchor.test", "Mine", passkey("c1"), 0);
    await replaceRecoveryCodes(db, userId, now);
    const { ticket } = await createMfaTicket(db, userId, "web", now);
    await db
      .prepare(
        "INSERT INTO login_attempts (key, failures, window_start, locked_until) VALUES (?, 0, ?, ?)",
      )
      .bind(`m|${userId}`, now, now + 900_000)
      .run();
    await resetUserMfa(db, userId);
    expect(await hasMfa(db, userId)).toBe(false);
    expect(await countRecoveryCodes(db, userId)).toBe(0);
    expect(await findMfaTicket(db, ticket, now)).toBeNull();
    expect(await db.prepare("SELECT 1 FROM login_attempts").first()).toBeNull();
  });

  it("purge drops expired tickets and challenges and day-old pending TOTP", async () => {
    const now = Date.now();
    const { ticket } = await createMfaTicket(db, userId, "web", now - MFA_TICKET_TTL_MS - 1);
    const t = await db.prepare("SELECT id FROM mfa_tickets").first<{ id: string }>();
    await storeChallenge(
      db,
      userId,
      { purpose: "login", ticketId: t?.id ?? "" },
      "c",
      now - CHALLENGE_TTL_MS - 1,
    );
    await startTotpEnrollment(db, await getRootKeyring(env), userId, now - 86_400_001);
    const live = await createMfaTicket(db, userId, "web", now);
    expect(await purgeMfa(db, now)).toBe(3);
    expect(await findMfaTicket(db, ticket, now)).toBeNull();
    expect(await findMfaTicket(db, live.ticket, now)).not.toBeNull();
  });
});

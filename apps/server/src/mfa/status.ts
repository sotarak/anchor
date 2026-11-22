import type { MfaMethod, MfaStatusDto } from "@anchor/shared";
import { REAUTH_WINDOW_MS } from "../auth/reauth-window";
import { listPasskeys, toPasskeyDto } from "./passkey-store";
import { countRecoveryCodes } from "./recovery-store";
import { hasConfirmedTotp } from "./totp-store";

/** "Has MFA" = a confirmed TOTP or at least one passkey (any hostname). */
const HAS_MFA = `(EXISTS (SELECT 1 FROM totp_credentials t WHERE t.user_id = ?1 AND t.confirmed_at IS NOT NULL)
  OR EXISTS (SELECT 1 FROM webauthn_credentials w WHERE w.user_id = ?1))`;

export async function hasMfa(db: D1Database, userId: string): Promise<boolean> {
  const row = await db.prepare(`SELECT ${HAS_MFA} AS on_`).bind(userId).first<{ on_: number }>();
  return row?.on_ === 1;
}

/** The factors this request can finish a login with: totp, passkey (this host), recovery. */
export async function loginMethods(
  db: D1Database,
  userId: string,
  rpId: string,
): Promise<MfaMethod[]> {
  const methods: MfaMethod[] = [];
  if (await hasConfirmedTotp(db, userId)) methods.push("totp");
  const here = await db
    .prepare("SELECT 1 AS one FROM webauthn_credentials WHERE user_id = ? AND rp_id = ? LIMIT 1")
    .bind(userId, rpId)
    .first();
  if (here) methods.push("passkey");
  methods.push("recovery");
  return methods;
}

export async function mfaStatus(
  db: D1Database,
  userId: string,
  rpId: string,
  reauthAt: number | null,
  now: number,
): Promise<MfaStatusDto> {
  const [totp, passkeys, recoveryCodesRemaining] = await Promise.all([
    hasConfirmedTotp(db, userId),
    listPasskeys(db, userId),
    countRecoveryCodes(db, userId),
  ]);
  const until = reauthAt === null ? null : reauthAt + REAUTH_WINDOW_MS;
  return {
    enabled: totp || passkeys.length > 0,
    totp,
    passkeys: passkeys.map((p) => toPasskeyDto(p, rpId)),
    recoveryCodesRemaining,
    reauthUntil: until !== null && until > now ? until : null,
  };
}

/** After removing a factor: no factor left means recovery codes go too. */
export async function afterFactorRemoved(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare(`DELETE FROM recovery_codes WHERE user_id = ?1 AND NOT ${HAS_MFA}`)
    .bind(userId)
    .run();
}

/** Reset 2FA: every factor, recovery code, pending login and the factor lock, atomically. */
export async function resetUserMfa(db: D1Database, userId: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM totp_credentials WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM webauthn_credentials WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM mfa_tickets WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM login_attempts WHERE key = ?").bind(`m|${userId}`),
  ]);
}

const PENDING_TOTP_MAX_AGE_MS = 86_400_000;

/** Daily cron: expired tickets and challenges, and enrollments abandoned for a day. */
export async function purgeMfa(db: D1Database, now: number): Promise<number> {
  const results = await db.batch([
    db.prepare("DELETE FROM webauthn_challenges WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM mfa_tickets WHERE expires_at <= ?").bind(now),
    db
      .prepare("DELETE FROM totp_credentials WHERE confirmed_at IS NULL AND created_at < ?")
      .bind(now - PENDING_TOTP_MAX_AGE_MS),
  ]);
  return results.reduce((n, r) => n + r.meta.changes, 0);
}

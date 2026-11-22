/**
 * TOTP (RFC 6238 over RFC 4226 HOTP): HMAC-SHA-1, 6 digits, 30-second steps, the previous,
 * current and next step accepted (spec 2026-11-22-v0.6.0-mfa). Replay protection (refusing a
 * step at or below the last accepted one) lives in totp-store.ts.
 */
export const TOTP_SECRET_BYTES = 20;
const PERIOD_MS = 30_000;
const DIGITS = 6;
const WINDOW = 1;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const SIX_DIGITS = /^[0-9]{6}$/;

/** RFC 4648 base32, upper case, no padding. */
export function base32Encode(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

/** Inverse of base32Encode; throws on characters outside the alphabet. */
export function base32Decode(s: string): Uint8Array {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of s) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error("invalid base32");
    buffer = ((buffer << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export async function hotp(secret: Uint8Array, counter: number, digits = DIGITS): Promise<string> {
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-1" }, false, [
    "sign",
  ]);
  const msg = new Uint8Array(8);
  const view = new DataView(msg.buffer);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const offset = (mac[19] ?? 0) & 0x0f;
  const binary =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0);
  return (binary % 10 ** digits).toString().padStart(digits, "0");
}

export function timeStep(nowMs: number): number {
  return Math.floor(nowMs / PERIOD_MS);
}

/** The step (s-1, s or s+1) whose code equals `code`, compared in constant time; else null. */
export async function matchTotp(
  secret: Uint8Array,
  code: string,
  nowMs: number,
): Promise<number | null> {
  if (!SIX_DIGITS.test(code)) return null;
  const submitted = new TextEncoder().encode(code);
  const current = timeStep(nowMs);
  let matched: number | null = null;
  // Every candidate is computed and compared, so timing does not reveal which step matched.
  for (let step = current - WINDOW; step <= current + WINDOW; step++) {
    const expected = new TextEncoder().encode(await hotp(secret, step));
    if (crypto.subtle.timingSafeEqual(expected, submitted) && matched === null) matched = step;
  }
  return matched;
}

/** The provisioning URI authenticator apps scan; the issuer names the instance. */
export function otpauthUri(p: { secret: string; email: string; hostname: string }): string {
  const issuer = `Anchor (${p.hostname})`;
  const label = encodeURIComponent(`${issuer}:${p.email}`);
  return `otpauth://totp/${label}?secret=${p.secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

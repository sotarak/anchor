import { toBase64Url, utf8Encode } from "../lib/encoding";

const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;

/** RFC 7636 S256: base64url(sha256(verifier)) equals the challenge, compared in constant time. */
export async function verifyPkceS256(verifier: string, challenge: string): Promise<boolean> {
  if (!VERIFIER.test(verifier)) return false;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", utf8Encode(verifier)));
  const actual = utf8Encode(toBase64Url(digest));
  const expected = utf8Encode(challenge);
  if (actual.byteLength !== expected.byteLength) return false;
  return crypto.subtle.timingSafeEqual(actual, expected);
}

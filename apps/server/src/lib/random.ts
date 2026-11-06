import { toBase64Url, toHex, utf8Encode } from "./encoding";

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function newId(): string {
  return crypto.randomUUID();
}

/** Session token: "anc_s_" + base64url(32 random bytes). Only its SHA-256 is stored. */
export function newSessionToken(): string {
  return `anc_s_${toBase64Url(randomBytes(32))}`;
}

export async function sha256Hex(s: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8Encode(s))));
}

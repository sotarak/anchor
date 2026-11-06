import { toBase64Url, toHex, utf8Encode } from "./encoding";

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function newId(): string {
  return crypto.randomUUID();
}

export type TokenKind = "anc_s" | "anc_st" | "anc_inv" | "anc_rst";

/** Bearer secret: "<kind>_" + base64url(32 random bytes). Only its SHA-256 hex is ever stored. */
export function newToken(kind: TokenKind): string {
  return `${kind}_${toBase64Url(randomBytes(32))}`;
}

/** Non-secret display prefix kept beside the hash so users can tell tokens apart. */
export function tokenPrefix(token: string): string {
  return token.slice(0, 12);
}

export function newSessionToken(): string {
  return newToken("anc_s");
}

export async function sha256Hex(s: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8Encode(s))));
}

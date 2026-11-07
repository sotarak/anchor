import { OAUTH_SCOPES, type OAuthScope } from "@anchor/shared";

export { OAUTH_SCOPES, type OAuthScope };

/** A client that asks for no scope gets read and write; reveal is never a default. */
export const DEFAULT_SCOPES: OAuthScope[] = ["secrets:read", "secrets:write"];

/**
 * Parses a space-separated `scope` parameter. Undefined or empty → the default; any unknown scope
 * → null (the caller answers `invalid_scope`). Duplicates are dropped, order kept.
 */
export function parseScopes(raw: string | undefined): OAuthScope[] | null {
  const parts = (raw ?? "").split(" ").filter(Boolean);
  if (parts.length === 0) return [...DEFAULT_SCOPES];
  const out: OAuthScope[] = [];
  for (const part of parts) {
    if (!(OAUTH_SCOPES as readonly string[]).includes(part)) return null;
    if (!out.includes(part as OAuthScope)) out.push(part as OAuthScope);
  }
  return out;
}

/** Scopes as stored in oauth_grants.scopes, back to a list (unknown entries dropped). */
export function splitScopes(stored: string): OAuthScope[] {
  return stored
    .split(" ")
    .filter((s): s is OAuthScope => (OAUTH_SCOPES as readonly string[]).includes(s));
}

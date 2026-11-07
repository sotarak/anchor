const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parse(uri: string): URL | null {
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}

const isLoopbackHttp = (u: URL) => u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname);

/**
 * A redirect URI a client may register: `https:`, or `http:` on a loopback host (RFC 8252), with
 * no fragment and no credentials.
 */
export function isValidRedirectUri(uri: string): boolean {
  const u = parse(uri);
  if (!u || uri.includes("#") || u.username || u.password) return false;
  return u.protocol === "https:" || isLoopbackHttp(u);
}

/**
 * Exact match against the registered URIs, except that a loopback redirect may use any port
 * (RFC 8252 §7.3): same scheme, host, path and query.
 */
export function isAllowedRedirect(registered: string[], requested: string): boolean {
  if (!isValidRedirectUri(requested)) return false;
  if (registered.includes(requested)) return true;
  const want = parse(requested);
  if (!want || !isLoopbackHttp(want)) return false;
  return registered.some((r) => {
    const have = parse(r);
    return (
      have !== null &&
      isLoopbackHttp(have) &&
      have.hostname === want.hostname &&
      have.pathname === want.pathname &&
      have.search === want.search
    );
  });
}

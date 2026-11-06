/**
 * Reads a one-time token from `#token=...` and removes the fragment from the address bar before
 * anything else runs (so it never reaches history, a Referer or a later request). The hash is
 * removed even when the token is missing or has the wrong prefix.
 */
export function takeFragmentToken(expectedPrefix: "anc_inv_" | "anc_rst_"): string | null {
  const hash = window.location.hash;
  if (hash === "") return null;
  window.history.replaceState(
    window.history.state,
    "",
    window.location.pathname + window.location.search,
  );
  const token = new URLSearchParams(hash.slice(1)).get("token");
  return token?.startsWith(expectedPrefix) ? token : null;
}

type Prefix = Parameters<typeof takeFragmentToken>[0];
const held = new Map<Prefix, string | null>();

/**
 * `takeFragmentToken`, made safe to call more than once: a route's beforeLoad can run several
 * times per visit, and only the first call still sees the fragment. A new fragment replaces the
 * held token. The page releases it on unmount so it does not outlive the visit.
 */
export function holdFragmentToken(prefix: Prefix): string | null {
  if (window.location.hash !== "") held.set(prefix, takeFragmentToken(prefix));
  return held.get(prefix) ?? null;
}

export function releaseFragmentToken(prefix: Prefix): void {
  held.delete(prefix);
}

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

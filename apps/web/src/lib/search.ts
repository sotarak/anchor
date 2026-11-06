import { normalizeSecretPath } from "@anchor/shared";

/**
 * `?path=` on project pages, normalized like the API does. The root and anything invalid are
 * dropped, so `search.path ?? "/"` is always a valid path and the URL stays clean. Dropping
 * means `path: undefined`, not a missing key: the router lays validated search over the raw one.
 */
export function pathSearch(search: Record<string, unknown>): { path?: string } {
  const none = { path: undefined };
  if (typeof search.path !== "string") return none;
  try {
    const path = normalizeSecretPath(search.path);
    return path === "/" ? none : { path };
  } catch {
    return none;
  }
}

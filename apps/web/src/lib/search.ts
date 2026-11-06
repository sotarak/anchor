/** `?path=` on project pages: kept as given here; pages validate it before use. */
export function pathSearch(search: Record<string, unknown>): { path?: string } {
  return typeof search.path === "string" ? { path: search.path } : {};
}

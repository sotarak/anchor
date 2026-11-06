/**
 * Folder path helpers. Every argument is a normalized path ("/" or "/a/b", see
 * normalizeSecretPath in @anchor/shared).
 */

/** "/a/b/c" -> ["/a", "/a/b", "/a/b/c"]; "/" -> []. */
export function ancestors(path: string): string[] {
  if (path === "/") return [];
  const out: string[] = [];
  let current = "";
  for (const segment of path.slice(1).split("/")) {
    current += `/${segment}`;
    out.push(current);
  }
  return out;
}

/** True when `path` is `prefix` or inside it. "/" contains everything; "/api" never "/apix". */
export function isWithin(path: string, prefix: string): boolean {
  return prefix === "/" || path === prefix || path.startsWith(`${prefix}/`);
}

/** The name of the direct child of `parent` that contains `path`, or null. */
export function childSegment(parent: string, path: string): string | null {
  if (path === parent || !isWithin(path, parent)) return null;
  const rest = parent === "/" ? path.slice(1) : path.slice(parent.length + 1);
  return rest.split("/")[0] || null;
}

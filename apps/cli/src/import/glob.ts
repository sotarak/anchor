/**
 * Matches a whole key against a glob: `*` is any run of characters, `?` is one character, and
 * everything else is literal. Case-sensitive, like keys.
 */
export function matchGlob(pattern: string, key: string): boolean {
  const body = pattern
    .split("")
    .map((ch) => {
      if (ch === "*") return ".*";
      if (ch === "?") return ".";
      return ch.replace(/[\\^$.|+()[\]{}/-]/g, "\\$&");
    })
    .join("");
  return new RegExp(`^${body}$`, "s").test(key);
}

/**
 * A slug suggestion from a display name: lowercase, every run of characters outside [a-z0-9]
 * becomes "-", at most 63 characters, no leading or trailing "-". May be empty.
 */
export function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 63)
    .replace(/-+$/, "");
}

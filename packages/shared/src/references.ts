import { normalizeSecretPath } from "./schemas/secrets";

/**
 * Secret references (spec §9): `${KEY}` (same environment and folder) or
 * `${<envSlug>:<path>/<KEY>}` such as `${prod:/db/PASSWORD}`. `$${` is a literal `${`. Anything
 * else that starts with `${` but does not match the grammar is literal text.
 */

/** environment null = the same environment and folder as the secret holding the reference. */
export type RefTarget = { environment: string | null; path: string | null; key: string };

export type ValueToken =
  | { type: "text"; text: string }
  | { type: "ref"; raw: string; target: RefTarget; start: number; end: number };

export const REFERENCE_LIMITS = {
  maxDepth: 5,
  maxSecrets: 500,
  /** Per expanded value. */
  maxExpandedBytes: 1_048_576,
  /**
   * Bytes that references add across one request (every value of a list, at every depth): the
   * memo makes repeated references free to load, so without this a folder of values that each
   * reference one large secret many times builds gigabytes. Plain text does not count.
   */
  maxReferencedBytesPerRequest: 16_777_216,
} as const;

// Alternation order matters: at one position "$${" (escape) wins over "${".
// Groups: 1 = env slug, 2 = folder path ("" for the root), 3 = key.
const TOKEN =
  /\$\$\{|\$\{(?:([a-z0-9][a-z0-9-]{0,62}):((?:\/[A-Za-z0-9_-]+)*)\/)?([A-Za-z_][A-Za-z0-9_]{0,254})\}/g;

export function tokenizeValue(value: string): ValueToken[] {
  const tokens: ValueToken[] = [];
  let pending = "";
  const flush = () => {
    if (pending) tokens.push({ type: "text", text: pending });
    pending = "";
  };
  let last = 0;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(value); m !== null; m = TOKEN.exec(value)) {
    pending += value.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[0] === "$${") {
      pending += "${";
      continue;
    }
    const [raw, environment, rawPath, key] = m;
    let path: string | null = null;
    if (environment !== undefined) {
      try {
        path = normalizeSecretPath(rawPath || "/");
      } catch {
        pending += raw; // grammar-shaped but too long or too deep: literal
        continue;
      }
    }
    flush();
    tokens.push({
      type: "ref",
      raw,
      target: { environment: environment ?? null, path, key: key as string },
      start: m.index,
      end: last,
    });
  }
  pending += value.slice(last);
  flush();
  return tokens;
}

export function formatReference(t: RefTarget): string {
  if (t.environment === null) return `\${${t.key}}`;
  const path = !t.path || t.path === "/" ? "" : t.path;
  return `\${${t.environment}:${path}/${t.key}}`;
}

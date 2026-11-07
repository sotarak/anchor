/** Letters of a CLI login user code: consonants only, so codes cannot spell words (RFC 8628 §6.1). */
export const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";

/**
 * The canonical `XXXX-XXXX` form of a code as a person typed it: whitespace and dashes dropped,
 * case ignored. Null unless exactly 8 letters from the alphabet remain.
 */
export function normalizeUserCode(raw: string): string | null {
  const letters = raw.replace(/[\s-]/g, "").toUpperCase();
  if (letters.length !== 8) return null;
  for (const ch of letters) if (!USER_CODE_ALPHABET.includes(ch)) return null;
  return `${letters.slice(0, 4)}-${letters.slice(4)}`;
}

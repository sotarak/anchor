import { fromBase64, toBase64Url, utf8Encode } from "../lib/encoding";

let cached: { raw: string; key: Promise<CryptoKey> } | undefined;

/**
 * The HMAC key for list tags: HKDF-SHA-256 over ANCHOR_ROOT_KEY with its own info string, so
 * it never doubles as an encryption key. Non-extractable, derived once per isolate.
 */
function etagKey(rootKey: string): Promise<CryptoKey> {
  if (cached?.raw === rootKey) return cached.key;
  const key = (async () => {
    const bytes = fromBase64(rootKey);
    try {
      const ikm = await crypto.subtle.importKey("raw", bytes, "HKDF", false, ["deriveKey"]);
      return await crypto.subtle.deriveKey(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: new Uint8Array(),
          info: utf8Encode("anchor/etag/v1"),
        },
        ikm,
        { name: "HMAC", hash: "SHA-256", length: 256 },
        false,
        ["sign"],
      );
    } finally {
      bytes.fill(0);
    }
  })();
  cached = { raw: rootKey, key };
  // A failed derivation is not remembered: the next request tries again.
  key.catch(() => {
    if (cached?.key === key) cached = undefined;
  });
  return key;
}

/**
 * A strong tag for an exact response body. Keyed, so a tag seen in a log cannot be used to
 * test guesses of the values in the body.
 */
export async function etagFor(env: { ANCHOR_ROOT_KEY: string }, body: string): Promise<string> {
  const mac = await crypto.subtle.sign(
    "HMAC",
    await etagKey(env.ANCHOR_ROOT_KEY),
    utf8Encode(body),
  );
  return `"${toBase64Url(new Uint8Array(mac).slice(0, 16))}"`;
}

/** RFC 9110 If-None-Match: weak comparison over a list; `*` matches any representation. */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  const opaque = (t: string) => t.trim().replace(/^W\//, "");
  if (header.trim() === "*") return true;
  return header.split(",").some((t) => opaque(t) === opaque(etag));
}

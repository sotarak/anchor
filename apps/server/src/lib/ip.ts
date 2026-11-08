const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const HEXTET = /^[0-9a-f]{1,4}$/;

/** The 8 hextets of an IPv6 address, or null when it is not one. Zone ids are dropped. */
function hextets(ip: string): string[] | null {
  const address = ip.split("%")[0] ?? "";
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill("0"), ...tail];
  return all.every((h) => HEXTET.test(h)) ? all : null;
}

/**
 * The key rate limits count an address under. One IPv6 host usually controls a whole /64, so
 * IPv6 counts by its /64 prefix; IPv4 (including IPv4-mapped IPv6) counts per address.
 */
export function rateLimitKey(ip: string | null): string | null {
  if (ip === null) return null;
  const lower = ip.trim().toLowerCase();
  if (IPV4.test(lower)) return lower;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (mapped?.[1]) return mapped[1];
  const parts = hextets(lower);
  if (!parts) return lower;
  const prefix = parts.slice(0, 4).map((h) => Number.parseInt(h, 16).toString(16));
  return `${prefix.join(":")}::/64`;
}

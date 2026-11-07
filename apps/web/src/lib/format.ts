const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const dateTimeFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});
const relativeFormat = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

/** "Apr 2, 2026" (local time). */
export function formatDate(ms: number): string {
  return dateFormat.format(ms);
}

/** "Apr 2, 2026, 2:05:09 PM" (local time), for audit timestamps. */
export function formatDateTime(ms: number): string {
  return dateTimeFormat.format(ms);
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86_400_000],
  ["month", 30 * 86_400_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
  ["second", 1000],
];

/** "3 minutes ago", "in 2 days". */
export function formatRelative(ms: number, now = Date.now()): string {
  const diff = ms - now;
  for (const [unit, size] of UNITS) {
    if (Math.abs(diff) >= size || unit === "second") {
      return relativeFormat.format(Math.round(diff / size), unit);
    }
  }
  return relativeFormat.format(0, "second");
}

/** "1 token", "3 tokens": `plural` is a regular English plural ending in "s". */
export function countLabel(n: number, plural: string): string {
  return `${n} ${n === 1 ? plural.replace(/s$/, "") : plural}`;
}

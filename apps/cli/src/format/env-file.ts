import { CliError, EXIT } from "../errors";

export type Entry = [key: string, value: string];

const BARE = /^[A-Za-z0-9_./:@+,-]*$/;

/**
 * One KEY=... line per entry, quoted so that the `dotenv` parser reads the value back exactly:
 * bare, then '...' (literal), then "..." (\n and \r escapes), then `...`. A value that fits
 * none of them fails instead of being written corrupted.
 */
export function formatDotenv(entries: Entry[]): string {
  return entries.map(([key, value]) => `${key}=${quoteDotenv(key, value)}\n`).join("");
}

function quoteDotenv(key: string, value: string): string {
  const multiline = /[\r\n]/.test(value);
  if (BARE.test(value)) return value;
  if (!multiline && !value.includes("'")) return `'${value}'`;
  if (!value.includes('"') && !/\\[nr]/.test(value)) {
    return `"${value.replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`;
  }
  if (!multiline && !value.includes("`")) return `\`${value}\``;
  throw new CliError(
    EXIT.ERROR,
    `Value of ${key} cannot be represented in dotenv format`,
    "Use --format json or --format yaml",
  );
}

export function formatJson(entries: Entry[]): string {
  const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${JSON.stringify(Object.fromEntries(sorted), null, 2)}\n`;
}

/** JSON strings are valid YAML double-quoted scalars; keys are quoted so NULL/true stay strings. */
export function formatYaml(entries: Entry[]): string {
  return entries.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}\n`).join("");
}

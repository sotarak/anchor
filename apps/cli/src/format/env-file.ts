import { decodeTypedValue, type SecretValueType } from "@anchor/shared";
import { CliError, EXIT } from "../errors";

/** One secret to write: its key, its stored (canonical) text and its type. */
export type Entry = { key: string; value: string; type: SecretValueType };

const BARE = /^[A-Za-z0-9_./:@+,-]*$/;

/**
 * One KEY=... line per entry, quoted so that the `dotenv` parser reads the value back exactly:
 * bare, then '...' (literal), then "..." (\n and \r escapes), then `...`. A value that fits
 * none of them fails instead of being written corrupted.
 */
export function formatDotenv(entries: Entry[]): string {
  return entries.map(({ key, value }) => `${key}=${quoteDotenv(key, value)}\n`).join("");
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

/** JSON and YAML carry types: a `number` is written as a number, a `json` value as its JSON. */
const typed = (e: Entry): unknown => decodeTypedValue(e.type, e.value);

export function formatJson(entries: Entry[]): string {
  const sorted = [...entries].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return `${JSON.stringify(Object.fromEntries(sorted.map((e) => [e.key, typed(e)])), null, 2)}\n`;
}

/**
 * JSON is valid YAML flow syntax: strings are double-quoted scalars, objects and arrays flow
 * collections. Keys are quoted so NULL/true stay strings.
 */
export function formatYaml(entries: Entry[]): string {
  return entries.map((e) => `${JSON.stringify(e.key)}: ${JSON.stringify(typed(e))}\n`).join("");
}

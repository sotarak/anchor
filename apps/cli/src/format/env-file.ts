import { decodeTypedValue, type SecretValueType } from "@anchor/shared";
import { CliError, EXIT } from "../errors";

/** One secret to write: its key, its stored (canonical) text and its type. */
export type Entry = { key: string; value: string; type: SecretValueType };

const BARE = /^[A-Za-z0-9_./:@+,-]*$/;

/**
 * One KEY=... line per entry, quoted so that the `dotenv` parser reads the value back exactly
 * AND a shell or docker-compose that sources the file runs and expands nothing: bare, then
 * '...' (literal everywhere), then "..." (\n and \r escapes) only for values without `"`, `$`,
 * a backtick or a backslash (a trailing `\` would escape the closing quote in sh and run the
 * next line as commands; `\\` means one backslash to sh and two to dotenv). A value that fits
 * none of them fails instead of being written unsafely or corrupted. (0.5.2 also wrote `...`, which a shell executes: removed in 0.5.3.)
 */
export function formatDotenv(entries: Entry[]): string {
  return entries.map(({ key, value }) => `${key}=${quoteDotenv(key, value)}\n`).join("");
}

function quoteDotenv(key: string, value: string): string {
  const multiline = /[\r\n]/.test(value);
  if (BARE.test(value)) return value;
  // dotenv reads `\'` inside single quotes as an escaped quote, so a trailing backslash would
  // swallow the closing quote and the lines after it.
  if (!multiline && !value.includes("'") && !value.endsWith("\\")) return `'${value}'`;
  if (!/["$`\\]/.test(value)) {
    return `"${value.replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`;
  }
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

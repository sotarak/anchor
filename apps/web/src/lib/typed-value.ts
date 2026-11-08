import type { SecretValueType } from "@anchor/shared";

/** The name and one line of help the type picker shows. The stored type values do not change. */
export const TYPE_META: Record<SecretValueType, { name: string; help: string }> = {
  string: { name: "Text", help: "Any text, one or more lines" },
  number: { name: "Number", help: "An integer or decimal, such as 8080 or 0.25" },
  boolean: { name: "Boolean", help: "true or false" },
  json: { name: "JSON", help: "An object, array or any JSON value" },
  list: { name: "List", help: "Several text items, stored as a JSON array" },
  pem: { name: "PEM", help: "A certificate or key block (-----BEGIN …)" },
};

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((item) => typeof item === "string");

/** True when `text` is already a JSON array of strings, the stored form of a list. */
export function isListText(text: string): boolean {
  try {
    return isStringArray(JSON.parse(text));
  } catch {
    return false;
  }
}

/** A list's items: a JSON array of strings as is, otherwise one item per non-blank line. */
export function listItemsFrom(text: string): string[] {
  if (isListText(text)) return JSON.parse(text) as string[];
  return text.split(/\r?\n/).filter((line) => line.trim() !== "");
}

/** The stored text of a list: its non-blank items as a JSON array, in the order shown. */
export function listTextFrom(items: string[]): string {
  return JSON.stringify(items.filter((item) => item.trim() !== ""));
}

/** Two-space pretty print, or null when the text is not valid JSON. */
export function formatJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

/** Line and column (1-based) of a character offset. */
function lineColumn(text: string, offset: number): [number, number] {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  return [line, offset - before.lastIndexOf("\n")];
}

/**
 * Null for valid JSON, else "not valid JSON", with the line and column when the engine's message
 * gives a position (V8: "at position N", Firefox: "at line L column C"). The message never
 * carries the value itself.
 */
export function jsonProblem(text: string): string | null {
  try {
    JSON.parse(text);
    return null;
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    const lc = /line (\d+) column (\d+)/.exec(message);
    if (lc) return `not valid JSON at line ${lc[1]}, column ${lc[2]}`;
    const pos = /position (\d+)/.exec(message);
    if (pos) {
      const [line, column] = lineColumn(text, Number(pos[1]));
      return `not valid JSON at line ${line}, column ${column}`;
    }
    return "not valid JSON";
  }
}

/** The label of the first `-----BEGIN <label>-----` line, or null. */
export function pemLabel(text: string): string | null {
  return /^-----BEGIN ([A-Z0-9 ]+)-----\r?$/m.exec(text)?.[1] ?? null;
}

/** The selected boolean option: only the exact text true or false selects one. */
export function booleanFrom(text: string): "true" | "false" | null {
  return text === "true" || text === "false" ? text : null;
}

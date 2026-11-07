import { basename } from "node:path";
import {
  checkTypedValue,
  type SecretValueType,
  secretKeySchema,
  secretValueSchema,
} from "@anchor/shared";
import { parse as parseDotenv } from "dotenv";
import { parse as parseYaml, YAMLParseError } from "yaml";
import { CliError, EXIT } from "../errors";

export type ImportFormat = "dotenv" | "json" | "yaml";
export const IMPORT_FORMATS: readonly ImportFormat[] = ["dotenv", "json", "yaml"];

/** One secret to import. `source` is the dotted path in the file, or the dotenv name. */
export type ImportEntry = { key: string; source: string; value: string; type: SecretValueType };
/** `empty` holds the source paths of nulls and empty objects: nothing is created for them. */
export type ParsedImport = { entries: ImportEntry[]; empty: string[] };

/** `.json`, `.yaml`/`.yml`, and `.env` or a name starting with `.env`; anything else is null. */
export function inferImportFormat(path: string): ImportFormat | null {
  const name = basename(path);
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".yaml") || name.endsWith(".yml")) return "yaml";
  if (name.startsWith(".env") || name.endsWith(".env")) return "dotenv";
  return null;
}

/** Each segment gets `-`, `.` and spaces turned into `_` and is uppercased; joined with `_`. */
export function toImportKey(segments: string[]): string {
  return segments.map((s) => s.replace(/[-. ]/g, "_").toUpperCase()).join("_");
}

const NOT_OBJECT = "The file must contain an object at the top level";

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The parsed document. Parser messages quote the input, so only a position is reported. */
function readDocument(text: string, format: "json" | "yaml"): unknown {
  try {
    return format === "json" ? JSON.parse(text) : parseYaml(text);
  } catch (e) {
    if (format === "json") throw new CliError(EXIT.USAGE, "The file is not valid JSON");
    const line = e instanceof YAMLParseError ? e.linePos?.[0]?.line : undefined;
    throw new CliError(
      EXIT.USAGE,
      `The file is not valid YAML${line === undefined ? "" : ` (line ${line})`}`,
    );
  }
}

/** A leaf as an entry's type and stored text; null for a null (reported as empty). */
function leaf(node: unknown): { type: SecretValueType; value: string } | null {
  if (node === null || node === undefined) return null;
  if (typeof node === "string") {
    return { type: checkTypedValue("pem", node).ok ? "pem" : "string", value: node };
  }
  if (typeof node === "number") return { type: "number", value: String(node) };
  if (typeof node === "boolean") return { type: "boolean", value: String(node) };
  if (Array.isArray(node)) {
    const strings = node.every((x) => typeof x === "string");
    return { type: strings ? "list" : "json", value: JSON.stringify(node) };
  }
  return { type: "json", value: JSON.stringify(node) };
}

function flatten(doc: Record<string, unknown>): {
  raw: { segments: string[]; type: SecretValueType; value: string }[];
  empty: string[];
} {
  const raw: { segments: string[]; type: SecretValueType; value: string }[] = [];
  const empty: string[] = [];
  const walk = (node: Record<string, unknown>, path: string[]) => {
    for (const [name, child] of Object.entries(node)) {
      const segments = [...path, name];
      if (isObject(child)) {
        if (Object.keys(child).length === 0) empty.push(segments.join("."));
        else walk(child, segments);
        continue;
      }
      const v = leaf(child);
      if (v) raw.push({ segments, ...v });
      else empty.push(segments.join("."));
    }
  };
  walk(doc, []);
  return { raw, empty };
}

/**
 * Turns a dotenv, JSON or YAML file into entries. Every problem (bad key, collision, value that
 * fails its type or size) is collected into one usage error, one per line; values are never
 * part of a message.
 */
export function parseImport(text: string, format: ImportFormat): ParsedImport {
  let candidates: ImportEntry[];
  let empty: string[] = [];
  if (format === "dotenv") {
    candidates = Object.entries(parseDotenv(text)).map(([name, value]) => ({
      key: name,
      source: name,
      value,
      type: "string",
    }));
  } else {
    const doc = readDocument(text, format);
    if (!isObject(doc)) throw new CliError(EXIT.USAGE, NOT_OBJECT);
    const flat = flatten(doc);
    empty = flat.empty;
    candidates = flat.raw.map((r) => ({
      key: toImportKey(r.segments),
      source: r.segments.join("."),
      value: r.value,
      type: r.type,
    }));
  }

  const errors: string[] = [];
  const seen = new Map<string, string>();
  const entries: ImportEntry[] = [];
  for (const entry of candidates) {
    if (!secretKeySchema.safeParse(entry.key).success) {
      errors.push(`Cannot import ${entry.source}: ${entry.key} is not a valid key`);
      continue;
    }
    const first = seen.get(entry.key);
    if (first !== undefined) {
      errors.push(`${first} and ${entry.source} both become ${entry.key}`);
      continue;
    }
    seen.set(entry.key, entry.source);
    const size = secretValueSchema.safeParse(entry.value);
    if (!size.success) {
      errors.push(`${entry.key}: ${size.error.issues[0]?.message ?? "value is too large"}`);
      continue;
    }
    const check = checkTypedValue(entry.type, entry.value);
    if (!check.ok) {
      errors.push(`${entry.key}: ${check.reason}`);
      continue;
    }
    entries.push(entry);
  }
  if (errors.length > 0) throw new CliError(EXIT.USAGE, errors.join("\n"));
  return { entries, empty };
}

import { z } from "zod";

/** Value types a secret version can declare. Order and spelling are part of the API. */
export const SECRET_VALUE_TYPES = ["string", "json", "pem", "number", "boolean", "list"] as const;
export type SecretValueType = (typeof SECRET_VALUE_TYPES)[number];
export const secretValueTypeSchema = z.enum(SECRET_VALUE_TYPES);

export type TypedValueCheck = { ok: true } | { ok: false; reason: string };

const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
const PEM_BEGIN = /^-----BEGIN ([A-Z0-9 ]+)-----$/;
const PEM_END = /^-----END ([A-Z0-9 ]+)-----$/;
const PEM_BASE64 = /^[A-Za-z0-9+/=]+$/;
const PEM_HEADER = /^[A-Za-z0-9-]+: ?.*$/;

const OK: TypedValueCheck = { ok: true };
const fail = (reason: string): TypedValueCheck => ({ ok: false, reason });

function parseJson(value: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false };
  }
}

function isPem(value: string): boolean {
  const lines = value.trim().split(/\r?\n/);
  let label: string | null = null;
  let bodyLines = 0;
  let blocks = 0;
  for (const line of lines) {
    if (label === null) {
      if (line.trim() === "") continue;
      const begin = PEM_BEGIN.exec(line);
      if (!begin) return false;
      label = begin[1] ?? "";
      bodyLines = 0;
      continue;
    }
    const end = PEM_END.exec(line);
    if (end) {
      if (end[1] !== label || bodyLines === 0) return false;
      label = null;
      blocks++;
      continue;
    }
    if (line === "" || PEM_HEADER.test(line)) continue;
    if (!PEM_BASE64.test(line)) return false;
    bodyLines++;
  }
  return label === null && blocks > 0;
}

/**
 * Accepts or rejects `value` as text of `type`. It never rewrites the value, and the reason
 * never contains the value.
 */
export function checkTypedValue(type: SecretValueType, value: string): TypedValueCheck {
  switch (type) {
    case "string":
      return OK;
    case "json":
      return parseJson(value).ok ? OK : fail("not valid JSON");
    case "pem":
      return isPem(value) ? OK : fail("not a PEM block");
    case "number":
      return NUMBER.test(value) && Number.isFinite(Number(value)) ? OK : fail("not a number");
    case "boolean":
      return value === "true" || value === "false" ? OK : fail("must be true or false");
    case "list": {
      const parsed = parseJson(value);
      return parsed.ok &&
        Array.isArray(parsed.value) &&
        parsed.value.every((item) => typeof item === "string")
        ? OK
        : fail("must be a JSON array of strings");
    }
  }
}

export { decodeTypedValue } from "./value-decode";

// Kept free of zod so the SDK can bundle it alone (`@anchor/shared/value-decode`).
import type { SecretValueType } from "./value-types";

/** Decodes a value that already passed `checkTypedValue` into its typed form. */
export function decodeTypedValue(type: SecretValueType, value: string): unknown {
  switch (type) {
    case "json":
    case "list":
      return JSON.parse(value);
    case "number":
      return Number(value);
    case "boolean":
      return value === "true";
    default:
      return value;
  }
}

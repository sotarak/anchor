import { parseSearchWith, stringifySearchWith } from "@tanstack/react-router";

/**
 * JSON.parse for search values, but only when the round trip is exact. The router's default
 * parses every value, so `12345678901234567890` becomes a rounded number and `"x"` loses its
 * quotes; OAuth parameters such as `state` must come back byte for byte. Throwing keeps the raw
 * string (that is how parseSearchWith treats parser errors).
 */
function losslessJson(value: string): unknown {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed === "string" || JSON.stringify(parsed) !== value) {
    throw new Error("not a lossless JSON value");
  }
  return parsed;
}

export const parseSearch = parseSearchWith(losslessJson);
export const stringifySearch = stringifySearchWith(JSON.stringify, losslessJson);

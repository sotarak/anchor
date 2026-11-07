import { decodeTypedValue } from "@anchor/shared/value-decode";
import { AnchorError } from "./errors.js";
import type { AnchorSecret, AnchorValue, AnchorValueType } from "./types.js";

export type WireSecret = {
  key: string;
  path: string;
  type: AnchorValueType;
  sensitive: boolean;
  version: number;
  value?: string;
  importedFrom?: { environment: string; path: string };
};

export function toSecret(s: WireSecret): AnchorSecret {
  if (typeof s.value !== "string") {
    throw new AnchorError(200, "bad_response", `Anchor returned ${s.key} without a value`);
  }
  const out: AnchorSecret = {
    key: s.key,
    path: s.path,
    type: s.type,
    sensitive: s.sensitive,
    version: s.version,
    value: s.value,
  };
  if (s.importedFrom) out.importedFrom = { ...s.importedFrom };
  return out;
}

function decode(s: AnchorSecret): AnchorValue {
  try {
    return decodeTypedValue(s.type, s.value) as AnchorValue;
  } catch {
    // Never echo the value: it may be sensitive.
    throw new AnchorError(200, "bad_response", `Secret ${s.key} is not valid ${s.type}`);
  }
}

/** `{ KEY: value }` with typed values decoded. The first secret of a key wins. */
export function decodeAll(secrets: AnchorSecret[]): Record<string, AnchorValue> {
  const entries = new Map<string, AnchorValue>();
  for (const s of secrets) {
    // The server already drops imported keys a local key shadows; keep the first regardless.
    if (!entries.has(s.key)) entries.set(s.key, decode(s));
  }
  return Object.fromEntries(entries);
}

type Level = "info" | "warn" | "error";

const SENSITIVE_KEY = /(value|password|token|secret|key|cookie|authorization)/i;

function redact(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(redact);
  if (input !== null && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[REDACTED]" : redact(v);
    }
    return out;
  }
  return input;
}

/** The only logging entry point in the server. Sensitive field names are always redacted. */
export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, event, ...(redact(fields) as Record<string, unknown>) });
  if (level === "error") console.error(line);
  else console.log(line);
}

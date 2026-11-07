/** D1 returns BLOB columns as number arrays; accept any byte-ish shape. */
export function toBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (Array.isArray(v)) return Uint8Array.from(v as number[]);
  throw new Error("expected BLOB column");
}

/** SQLite UNIQUE / PRIMARY KEY violations both report "UNIQUE constraint failed". */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/.test(err.message);
}

/** The secret_versions_reject_retired_kek trigger (migration 0004) refused the insert. */
export function isRetiredKekWrite(err: unknown): boolean {
  return err instanceof Error && /retired_kek/.test(err.message);
}

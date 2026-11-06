/** Structural, so schemas from @anchor/shared work whatever zod copy it resolved. */
type Schema = {
  safeParse(values: unknown): { success: boolean; error?: { issues: { path: PropertyKey[] }[] } };
};

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

/**
 * Validates `values` with a shared schema and returns one message per failing field, taken from
 * `messages` (schema messages are written for API clients, not people).
 */
export function validate<K extends string>(
  schema: Schema,
  values: Record<string, unknown>,
  messages: Record<K, string>,
): FieldErrors<K> {
  const result = schema.safeParse(values);
  const errors: FieldErrors<K> = {};
  for (const issue of result.error?.issues ?? []) {
    const key = issue.path[0] as K;
    if (key in messages && !errors[key]) errors[key] = messages[key];
  }
  return errors;
}

export const PASSWORD_HINT = "At least 12 characters";
export const PASSWORD_MISMATCH = "Passwords do not match";

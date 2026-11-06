import type { Context } from "hono";
import type { z } from "zod";
import { ApiError } from "./errors";

function check<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues;
  if (issues.some((i) => i.code === "custom" && i.params?.code === "payload_too_large")) {
    throw new ApiError(413, "payload_too_large", "Payload too large");
  }
  // Report field paths and issue codes only — never the rejected input.
  const fields = issues.map((i) => `${i.path.length ? i.path.join(".") : "(root)"} (${i.code})`);
  throw new ApiError(400, "bad_request", `invalid fields: ${fields.join(", ")}`);
}

export async function parseJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let input: unknown;
  try {
    input = await c.req.json();
  } catch {
    throw new ApiError(400, "bad_request", "Invalid JSON body");
  }
  return check(schema, input);
}

export function parseQuery<S extends z.ZodType>(c: Context, schema: S): z.output<S> {
  return check(schema, c.req.query());
}

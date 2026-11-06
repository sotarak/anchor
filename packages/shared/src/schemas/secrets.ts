import { z } from "zod";
import { utf8ByteLength } from "./common";

export const MAX_SECRET_VALUE_BYTES = 65536;
const MAX_PATH_LENGTH = 256;
const MAX_PATH_DEPTH = 10;
const PATH_SEGMENT = /^[A-Za-z0-9_-]+$/;

/** Canonical folder path: "/" or "/a/b". Throws Error("invalid path"). */
export function normalizeSecretPath(input: string): string {
  if (input === "" || input === "/") return "/";
  let s = input.startsWith("/") ? input : `/${input}`;
  if (s.endsWith("/")) s = s.slice(0, -1);
  if (s.length > MAX_PATH_LENGTH) throw new Error("invalid path");
  const segments = s.slice(1).split("/");
  if (segments.length > MAX_PATH_DEPTH) throw new Error("invalid path");
  for (const segment of segments) {
    if (!PATH_SEGMENT.test(segment)) throw new Error("invalid path");
  }
  return s;
}

export const secretKeySchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,254}$/);

export const secretValueSchema = z.string().superRefine((value, ctx) => {
  if (utf8ByteLength(value) > MAX_SECRET_VALUE_BYTES) {
    ctx.addIssue({
      code: "custom",
      message: `value exceeds ${MAX_SECRET_VALUE_BYTES} bytes`,
      params: { code: "payload_too_large" },
    });
  }
});

export const secretPathSchema = z.string().transform((value, ctx) => {
  try {
    return normalizeSecretPath(value);
  } catch {
    ctx.addIssue({ code: "custom", message: "invalid path" });
    return z.NEVER;
  }
});

export const putSecretBodySchema = z.object({
  value: secretValueSchema,
  comment: z.string().max(500).default(""),
  path: secretPathSchema.default("/"),
});

const queryFlag = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

export const secretQuerySchema = z.object({
  path: secretPathSchema.default("/"),
  reveal: queryFlag,
  /** Expand ${...} references in returned values (M5). */
  expand: queryFlag,
  /** Add the secrets of this folder's imports (M5). */
  includeImports: queryFlag,
});

/** A version number in a URL: a positive integer without sign or leading zeros. */
export const secretVersionParamSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,9}$/)
  .transform(Number);

export const rollbackBodySchema = z.object({
  path: secretPathSchema.default("/"),
  version: z.number().int().min(1),
});

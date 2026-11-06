import { z } from "zod";

export const MAX_SECRET_VALUE_BYTES = 65536;
const MAX_PATH_LENGTH = 256;
const MAX_PATH_DEPTH = 10;
const PATH_SEGMENT = /^[A-Za-z0-9_-]+$/;

const encoder = new TextEncoder();

export function utf8ByteLength(s: string): number {
  return encoder.encode(s).byteLength;
}

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

export const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
export const secretKeySchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,254}$/);
export const passwordSchema = z.string().min(12).max(1024);
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

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

export const setupBodySchema = z.object({
  setupToken: z.string().min(1).max(512),
  email: emailSchema,
  name: z.string().min(1).max(100),
  password: passwordSchema,
});

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(1024),
  client: z.enum(["web", "cli"]).default("web"),
});

export const createProjectBodySchema = z.object({
  name: z.string().min(1).max(64),
  slug: slugSchema,
});

export const updateProjectBodySchema = z.object({ name: z.string().min(1).max(64) });

export const createEnvironmentBodySchema = z.object({
  name: z.string().min(1).max(64),
  slug: slugSchema,
});

export const updateEnvironmentBodySchema = z.object({ name: z.string().min(1).max(64) });

export const putSecretBodySchema = z.object({
  value: secretValueSchema,
  comment: z.string().max(500).default(""),
  path: secretPathSchema.default("/"),
});

export const secretQuerySchema = z.object({
  path: secretPathSchema.default("/"),
  reveal: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

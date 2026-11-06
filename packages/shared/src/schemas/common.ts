import { z } from "zod";

const encoder = new TextEncoder();

export function utf8ByteLength(s: string): number {
  return encoder.encode(s).byteLength;
}

export const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
export const passwordSchema = z.string().min(12).max(1024);
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

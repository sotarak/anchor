import { z } from "zod";
import { emailSchema, passwordSchema } from "./common";

// No setup token (0.3.0): the first submission creates the owner. Unknown keys such as a legacy
// `setupToken` are stripped, so older clients keep working.
export const setupBodySchema = z.object({
  email: emailSchema,
  name: z.string().min(1).max(100),
  password: passwordSchema,
});

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(1024),
  client: z.enum(["web", "cli"]).default("web"),
});

/** One-time link tokens (invite, password reset) as submitted by clients. */
export const linkTokenSchema = z.string().min(1).max(200);

export const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: passwordSchema,
});

export const resetPasswordBodySchema = z.object({
  token: linkTokenSchema,
  password: passwordSchema,
});

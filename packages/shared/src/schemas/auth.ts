import { z } from "zod";
import { emailSchema, passwordSchema } from "./common";

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

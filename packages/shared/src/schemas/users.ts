import { z } from "zod";

export const instanceRoleSchema = z.enum(["owner", "admin", "member"]);

export const updateUserBodySchema = z
  .object({ role: instanceRoleSchema.optional(), disabled: z.boolean().optional() })
  .refine((b) => b.role !== undefined || b.disabled !== undefined, {
    message: "at least one field is required",
  });

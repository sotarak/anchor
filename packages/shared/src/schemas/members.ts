import { z } from "zod";
import { emailSchema, slugSchema } from "./common";

export const projectRoleSchema = z.enum(["admin", "developer", "viewer"]);

const environmentSlugsSchema = z
  .array(slugSchema)
  .min(1)
  .max(50)
  .refine((slugs) => new Set(slugs).size === slugs.length, { message: "duplicate environment" });

const ADMIN_HAS_ALL_ENVIRONMENTS = {
  message: "a project admin cannot be restricted to environments",
  path: ["environments"],
};

export const addMemberBodySchema = z
  .object({
    email: emailSchema,
    role: projectRoleSchema,
    environments: environmentSlugsSchema.nullable().default(null),
  })
  .refine((b) => b.role !== "admin" || b.environments === null, ADMIN_HAS_ALL_ENVIRONMENTS);

export const updateMemberBodySchema = z
  .object({
    role: projectRoleSchema.optional(),
    environments: environmentSlugsSchema.nullable().optional(),
  })
  .refine((b) => b.role !== undefined || b.environments !== undefined, {
    message: "at least one field is required",
  })
  .refine(
    (b) => !(b.role === "admin" && b.environments !== undefined && b.environments !== null),
    ADMIN_HAS_ALL_ENVIRONMENTS,
  );

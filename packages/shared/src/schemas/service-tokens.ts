import { z } from "zod";
import { slugSchema } from "./common";
import { secretPathSchema } from "./secrets";

export const serviceTokenPermissionSchema = z.enum(["read", "read-write"]);

export const createServiceTokenBodySchema = z.object({
  name: z.string().min(1).max(64),
  permission: serviceTokenPermissionSchema,
  scopes: z
    .array(z.object({ environment: slugSchema, path: secretPathSchema }))
    .min(1)
    .max(20),
  /** null = the token never expires. Still required, so an omitted field is a 400. */
  expiresInDays: z.number().int().min(1).max(365).nullable(),
});

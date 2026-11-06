import { z } from "zod";
import { AUDIT_ACTIONS } from "../audit";

export const auditQuerySchema = z.object({
  projectId: z.string().min(1).max(64).optional(),
  actorId: z.string().min(1).max(64).optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  before: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

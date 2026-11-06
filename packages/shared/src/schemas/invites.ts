import { z } from "zod";
import { linkTokenSchema } from "./auth";
import { emailSchema, passwordSchema } from "./common";
import { instanceRoleSchema } from "./users";

export const createInviteBodySchema = z.object({ email: emailSchema, role: instanceRoleSchema });

export const inviteTokenBodySchema = z.object({ token: linkTokenSchema });

export const acceptInviteBodySchema = z.object({
  token: linkTokenSchema,
  name: z.string().min(1).max(100),
  password: passwordSchema,
});

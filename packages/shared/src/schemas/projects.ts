import { z } from "zod";
import { slugSchema } from "./common";

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

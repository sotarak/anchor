import { z } from "zod";
import { slugSchema } from "./common";
import { secretPathSchema } from "./secrets";

export const importQuerySchema = z.object({ path: secretPathSchema.default("/") });

export const createImportBodySchema = z.object({
  path: secretPathSchema.default("/"),
  source: z.object({ environment: slugSchema, path: secretPathSchema }),
});

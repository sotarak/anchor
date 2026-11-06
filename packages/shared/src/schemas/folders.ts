import { z } from "zod";
import { secretPathSchema } from "./secrets";

const booleanFlag = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

export const folderQuerySchema = z.object({ path: secretPathSchema.default("/") });

export const createFolderBodySchema = z.object({
  path: secretPathSchema.refine((p) => p !== "/", "the root folder always exists"),
});

export const deleteFolderQuerySchema = z.object({
  path: secretPathSchema,
  force: booleanFlag,
});

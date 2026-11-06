import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, win32 } from "node:path";
import { z } from "zod";
import { CliError, EXIT } from "../errors";
import type { Io } from "../io";

const userConfigSchema = z.object({ apiUrl: z.string().optional() });
export type UserConfig = z.infer<typeof userConfigSchema>;

export function userConfigDir(io: Io): string {
  if (io.platform === "win32") {
    const appData = io.env.APPDATA ?? win32.join(io.homeDir, "AppData", "Roaming");
    return win32.join(appData, "anchor");
  }
  const xdg = io.env.XDG_CONFIG_HOME;
  return xdg ? join(xdg, "anchor") : join(io.homeDir, ".config", "anchor");
}

export async function readUserConfig(io: Io): Promise<UserConfig> {
  const path = join(userConfigDir(io), "config.json");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
  try {
    return userConfigSchema.parse(JSON.parse(text));
  } catch {
    throw new CliError(EXIT.ERROR, `${path} is invalid`, `Fix or delete ${path}`);
  }
}

export async function writeUserConfig(io: Io, cfg: UserConfig): Promise<void> {
  const dir = userConfigDir(io);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "config.json");
  await writeFile(path, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

import { randomBytes } from "node:crypto";
import { chmod, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Spawner } from "./context";

/**
 * Writes `content` so that the file is never readable by others, even for an instant: a temp
 * file created 0600 in the same directory is renamed over the target, then chmod'ed again.
 */
export async function writeSecretFile(path: string, content: string): Promise<void> {
  const tmp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  const handle = await open(tmp, "wx", 0o600);
  try {
    await handle.writeFile(content);
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
  await chmod(path, 0o600);
}

/** true/false from `git check-ignore`; null when git is missing or the dir is not a repo. */
export async function isGitIgnored(path: string, spawner: Spawner): Promise<boolean | null> {
  try {
    const r = await spawner("git", [
      "-C",
      dirname(path),
      "check-ignore",
      "-q",
      "--",
      basename(path),
    ]);
    if (r.code === 0) return true;
    if (r.code === 1) return false;
    return null;
  } catch {
    return null;
  }
}

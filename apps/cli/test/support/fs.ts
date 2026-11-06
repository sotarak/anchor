import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";

/** A fresh temp directory, removed when the current test finishes. */
export async function tmpDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "anchor-cli-")));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

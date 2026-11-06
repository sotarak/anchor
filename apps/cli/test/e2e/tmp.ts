import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A temp directory for the whole e2e run (beforeAll), left for the OS to clean up. */
export async function tmpDirOutsideTest(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), "anchor-e2e-")));
}

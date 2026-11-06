import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Removes the throwaway env file even if the launcher was killed before its own cleanup ran. */
export default function globalTeardown() {
  rmSync(fileURLToPath(new URL("./.state/e2e.env", import.meta.url)), { force: true });
}

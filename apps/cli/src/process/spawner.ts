import { spawn } from "node:child_process";
import type { Spawner } from "../context";

/** Captured helper processes (keychain tools, git). Never a shell; secrets only via stdin. */
export function createNodeSpawner(): Spawner {
  return (cmd, args, opts) =>
    new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { shell: false, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (d: string) => {
        stdout += d;
      });
      child.stderr.setEncoding("utf8").on("data", (d: string) => {
        stderr += d;
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
      child.stdin.on("error", () => {}); // The helper may exit before reading stdin (EPIPE).
      child.stdin.end(opts?.input ?? "");
    });
}

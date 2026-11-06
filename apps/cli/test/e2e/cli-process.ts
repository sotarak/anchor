import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TSX = join(CLI_ROOT, "node_modules", ".bin", "tsx");
const MAIN = join(CLI_ROOT, "src", "bin.ts");

export type CliResult = { code: number; stdout: string; stderr: string };
export type CliRunner = (
  args: string[],
  opts?: { stdin?: string; env?: Record<string, string | undefined> },
) => Promise<CliResult>;

/**
 * Runs the CLI as a child process: pipes only (non-TTY), file credential store, no color.
 * `ctx()` is read on every call, so the caller can set the API URL and dirs in beforeAll.
 */
export function cliRunner(ctx: () => { home: string; cwd: string; apiUrl: string }): CliRunner {
  return (args, opts = {}) => {
    const { home, cwd, apiUrl } = ctx();
    const env: Record<string, string | undefined> = {
      PATH: process.env.PATH,
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      ANCHOR_CREDENTIAL_STORE: "file",
      NO_COLOR: "1",
      ANCHOR_API_URL: apiUrl,
      ...opts.env,
    };
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
    return new Promise((resolve, reject) => {
      const child = spawn(TSX, [MAIN, ...args], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (d: string) => {
        stdout += d;
      });
      child.stderr.setEncoding("utf8").on("data", (d: string) => {
        stderr += d;
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
      child.stdin.end(opts.stdin ?? "");
    });
  };
}

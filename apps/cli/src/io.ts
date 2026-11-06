import { homedir } from "node:os";

export interface Io {
  stdout: { write(s: string): void };
  stderr: { write(s: string): void };
  readStdin(): Promise<string>;
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  stderrIsTTY: boolean;
  env: Record<string, string | undefined>;
  cwd: string;
  platform: NodeJS.Platform;
  homeDir: string;
}

export function createNodeIo(): Io {
  return {
    stdout: { write: (s) => void process.stdout.write(s) },
    stderr: { write: (s) => void process.stderr.write(s) },
    readStdin: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString("utf8");
    },
    stdinIsTTY: process.stdin.isTTY === true,
    stdoutIsTTY: process.stdout.isTTY === true,
    stderrIsTTY: process.stderr.isTTY === true,
    env: process.env,
    cwd: process.cwd(),
    platform: process.platform,
    homeDir: homedir(),
  };
}

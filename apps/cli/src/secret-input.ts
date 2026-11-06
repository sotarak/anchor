import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MAX_SECRET_VALUE_BYTES, secretValueSchema } from "@anchor/shared";
import type { CommandContext } from "./context";
import { CliError, EXIT } from "./errors";
import { stripOneNewline } from "./interactive";

const ARGV_ERROR = "Secret values are not accepted as command-line arguments";
const ARGV_HINT = "Pipe the value on stdin or use --from-file <path>";

/** Options that consume the next argument, so it is not mistaken for the KEY positional. */
const VALUE_OPTIONS = new Set([
  "--api-url",
  "--project",
  "--env",
  "--path",
  "--comment",
  "--from-file",
  "--format",
  "--output",
]);

/**
 * Rejects argv that carries a secret value: `--value[=...]` anywhere, or `secrets set KEY=value`.
 * Arguments after `--` belong to a child command and are not inspected. Never echoes the input.
 */
export function assertNoSecretInArgv(argv: string[]): void {
  const end = argv.indexOf("--");
  const args = end === -1 ? argv : argv.slice(0, end);
  if (args.some((a) => a === "--value" || a.startsWith("--value="))) {
    throw new CliError(EXIT.USAGE, ARGV_ERROR, ARGV_HINT);
  }
  const set = args.findIndex((a, i) => a === "secrets" && args[i + 1] === "set");
  if (set === -1) return;
  for (let i = set + 2; i < args.length; i++) {
    const a = args[i] as string;
    if (VALUE_OPTIONS.has(a)) {
      i++;
      continue;
    }
    if (a.startsWith("-")) continue;
    if (a.includes("=")) throw new CliError(EXIT.USAGE, ARGV_ERROR, ARGV_HINT);
    return; // The first positional is the KEY; anything else is a usage error for Commander.
  }
}

/** Reads a secret value from --from-file (exact bytes), piped stdin, or a hidden prompt. */
export async function readSecretValue(
  ctx: CommandContext,
  key: string,
  opts: { fromFile?: string },
): Promise<string> {
  const { io, prompts } = ctx.deps;
  let value: string;
  if (opts.fromFile !== undefined) {
    try {
      value = await readFile(resolve(io.cwd, opts.fromFile), "utf8");
    } catch {
      throw new CliError(EXIT.USAGE, `Cannot read ${opts.fromFile}`);
    }
  } else if (!io.stdinIsTTY) {
    value = stripOneNewline(await io.readStdin());
  } else {
    value = await prompts.password({ message: `Value for ${key}` });
  }
  if (!secretValueSchema.safeParse(value).success) {
    throw new CliError(EXIT.USAGE, `Value for ${key} exceeds ${MAX_SECRET_VALUE_BYTES} bytes`);
  }
  return value;
}

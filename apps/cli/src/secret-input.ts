import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MAX_SECRET_VALUE_BYTES, secretValueSchema } from "@anchor/shared";
import { positionals } from "./argv";
import type { CommandContext } from "./context";
import { CliError, EXIT } from "./errors";
import { stripOneNewline } from "./interactive";

const ARGV_ERROR = "Secret values are not accepted as command-line arguments";
const ARGV_HINT = "Pipe the value on stdin or use --from-file <path>";

/**
 * Rejects argv that carries a secret value: `--value[=...]` before `--`, or for `secrets set`
 * any positional containing `=` or more than one positional (also after `--`, which belongs to
 * `set` there). For other commands, arguments after `--` belong to a child command and are not
 * inspected. Never echoes the input.
 */
export function assertNoSecretInArgv(argv: string[]): void {
  const end = argv.indexOf("--");
  const head = end === -1 ? argv : argv.slice(0, end);
  if (head.some((a) => a === "--value" || a.startsWith("--value="))) {
    throw new CliError(EXIT.USAGE, ARGV_ERROR, ARGV_HINT);
  }
  const pos = positionals(argv);
  const [first, second, ...rest] = pos;
  if (first?.value !== "secrets" || first.afterDashDash) return;
  if (second?.value !== "set" || second.afterDashDash) return;
  if (rest.length > 1 || rest.some((p) => p.value.includes("="))) {
    throw new CliError(EXIT.USAGE, ARGV_ERROR, ARGV_HINT);
  }
}

/**
 * Reads a secret value from --from-file (exact bytes), piped stdin (non-empty), or a hidden
 * prompt.
 */
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
    // Nothing piped (</dev/null, a hook or IDE task) must not silently blank the secret.
    if (value === "") {
      throw new CliError(
        EXIT.USAGE,
        `No value on stdin for ${key}`,
        "Pipe the value, or use --from-file <path> for an empty value",
      );
    }
  } else {
    value = await prompts.password({ message: `Value for ${key}` });
  }
  if (!secretValueSchema.safeParse(value).success) {
    throw new CliError(EXIT.USAGE, `Value for ${key} exceeds ${MAX_SECRET_VALUE_BYTES} bytes`);
  }
  return value;
}

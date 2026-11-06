import type { CliError } from "./errors";
import type { Io } from "./io";

export type OutputOptions = { json: boolean; quiet: boolean; noColor: boolean; debug: boolean };

export function shouldUseColor(stream: "stdout" | "stderr", io: Io, noColorFlag: boolean): boolean {
  const isTTY = stream === "stdout" ? io.stdoutIsTTY : io.stderrIsTTY;
  if (!isTTY || noColorFlag) return false;
  if (io.env.NO_COLOR !== undefined && io.env.NO_COLOR !== "") return false;
  return io.env.TERM !== "dumb";
}

const paint = (on: boolean, code: number, s: string) => (on ? `\x1b[${code}m${s}\x1b[0m` : s);

/** All terminal output goes through here: stdout carries data only, stderr everything else. */
export class Output {
  constructor(
    private readonly io: Io,
    readonly opts: OutputOptions,
  ) {}

  data(json: unknown, human: () => string): void {
    if (this.opts.json) {
      this.io.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
      return;
    }
    const text = human();
    this.io.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
  }

  raw(text: string): void {
    this.io.stdout.write(text);
  }

  info(msg: string): void {
    if (this.opts.quiet || this.opts.json) return;
    this.io.stderr.write(`${msg}\n`);
  }

  /** A status line that is never suppressed (e.g. which server a login targets). */
  notice(msg: string): void {
    this.io.stderr.write(`${msg}\n`);
  }

  warn(msg: string): void {
    this.io.stderr.write(`${paint(this.color(), 33, "warning:")} ${msg}\n`);
  }

  error(err: CliError): void {
    let text = `${paint(this.color(), 31, "error:")} ${err.message}\n`;
    if (err.hint) text += `hint: ${err.hint}\n`;
    this.io.stderr.write(text);
  }

  debug(line: string): void {
    if (this.opts.debug) this.io.stderr.write(`debug: ${line}\n`);
  }

  table(headers: string[], rows: string[][]): string {
    const all = [headers, ...rows];
    const widths = headers.map((_, i) => Math.max(...all.map((r) => (r[i] ?? "").length)));
    return all
      .map((r) =>
        r
          .map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i] ?? 0)))
          .join("  ")
          .trimEnd(),
      )
      .join("\n");
  }

  private color(): boolean {
    return shouldUseColor("stderr", this.io, this.opts.noColor);
  }
}

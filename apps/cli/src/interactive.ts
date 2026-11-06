import type { CommandContext } from "./context";

/** Prompts need a terminal on both ends: they read stdin and render on stderr. */
export function isInteractive(ctx: CommandContext): boolean {
  return ctx.deps.io.stdinIsTTY && ctx.deps.io.stderrIsTTY;
}

/** Strips exactly one trailing "\n" or "\r\n" (what `echo` or a heredoc adds). */
export function stripOneNewline(s: string): string {
  if (s.endsWith("\r\n")) return s.slice(0, -2);
  if (s.endsWith("\n")) return s.slice(0, -1);
  return s;
}

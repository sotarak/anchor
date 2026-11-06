/** Options that consume the next argument, so it is not mistaken for a positional. */
const VALUE_OPTIONS = new Set([
  "--api-url",
  "--project",
  "--env",
  "--path",
  "--comment",
  "--from-file",
  "--format",
  "--output",
  "--email",
  "--name",
  "--scope",
  "--permission",
  "--expires-in",
  "--at-version",
  "--to",
]);

export interface Positional {
  value: string;
  /** True when the argument came after the first `--`. */
  afterDashDash: boolean;
}

/** The positional arguments of raw argv (no node/script prefix), skipping option values. */
export function positionals(args: string[]): Positional[] {
  const out: Positional[] = [];
  let afterDashDash = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (afterDashDash) out.push({ value: a, afterDashDash });
    else if (a === "--") afterDashDash = true;
    else if (VALUE_OPTIONS.has(a)) i++;
    else if (!a.startsWith("-")) out.push({ value: a, afterDashDash });
  }
  return out;
}

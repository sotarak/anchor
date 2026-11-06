export const EXIT = {
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  AUTH: 3,
  FORBIDDEN: 4,
  NOT_FOUND: 5,
  CONFLICT: 6,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** An expected failure: printed as `error: <message>` (+ `hint:`), exits with `exitCode`. */
export class CliError extends Error {
  constructor(
    readonly exitCode: number,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}

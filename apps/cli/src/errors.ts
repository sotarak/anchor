import { ApiRequestError } from "./api/http";

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
    /** The API error code when this came from a server response. */
    readonly apiCode?: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}

const NO_EXPAND_HINT = "Use --no-expand to skip reference expansion.";

/**
 * A 400 from a read with expansion on is a reference problem (unresolved, cycle, too deep,
 * too large): keep the server's message and point at --no-expand.
 */
export async function withExpandHint<T>(expand: boolean, call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (e) {
    if (expand && e instanceof CliError && e.apiCode === "bad_request") {
      throw new CliError(e.exitCode, e.message, NO_EXPAND_HINT, e.apiCode);
    }
    throw e;
  }
}

export function exitCodeForApiError(e: ApiRequestError): number {
  switch (e.code) {
    case "unauthenticated":
    case "invalid_credentials":
      return EXIT.AUTH;
    case "forbidden":
      return EXIT.FORBIDDEN;
    case "not_found":
      return EXIT.NOT_FOUND;
    case "conflict":
      return EXIT.CONFLICT;
    default:
      return EXIT.ERROR;
  }
}

/** Turns an API failure into a user-facing error. Anything unexpected is rethrown. */
export function toCliError(
  e: unknown,
  ctx: { apiUrl: string; authSource?: "ANCHOR_TOKEN" | "stored" },
): CliError {
  if (e instanceof CliError) return e;
  if (!(e instanceof ApiRequestError)) throw e;
  if (e.code === "unauthenticated" && ctx.authSource === "stored") {
    return new CliError(EXIT.AUTH, "Your session has expired or was revoked", "Run 'anchor login'");
  }
  if (e.code === "unauthenticated" && ctx.authSource === "ANCHOR_TOKEN") {
    return new CliError(EXIT.AUTH, "ANCHOR_TOKEN was rejected (expired, revoked or invalid)");
  }
  return new CliError(exitCodeForApiError(e), e.message, undefined, e.code);
}

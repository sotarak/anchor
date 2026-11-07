export type AnchorErrorOptions = {
  cause?: unknown;
  /** Whether repeating the request may succeed; default `false`. */
  retryable?: boolean;
  /** How long the server asked the client to wait (`Retry-After`). */
  retryAfterMs?: number;
};

/**
 * Every failure of the client. `code` is `config`, `network`, `timeout`, `aborted`,
 * `bad_response`, `http_error` or the API's error code (`unauthenticated`, `forbidden`,
 * `not_found`, ...). `status` is the HTTP status, or 0 when there was no response. Messages never
 * contain tokens or values.
 */
export class AnchorError extends Error {
  readonly status: number;
  readonly code: string;
  /** Whether repeating the request may succeed (network, timeout, 429, 502, 503, 504). */
  readonly retryable: boolean;
  /** The server's `Retry-After`, in milliseconds, when it sent one. */
  readonly retryAfterMs?: number;

  constructor(status: number, code: string, message: string, options: AnchorErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AnchorError";
    this.status = status;
    this.code = code;
    this.retryable = options.retryable ?? false;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
  }
}

export const abortedError = () =>
  new AnchorError(0, "aborted", "The request to Anchor was cancelled");

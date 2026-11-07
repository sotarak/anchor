/**
 * Every failure of the client. `code` is `config`, `network`, `timeout`, `bad_response`, `http_error`
 * or the API's error code (`unauthenticated`, `forbidden`, `not_found`, ...). `status` is the
 * HTTP status, or 0 when there was no response. Messages never contain tokens or values.
 */
export class AnchorError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AnchorError";
    this.status = status;
    this.code = code;
  }
}

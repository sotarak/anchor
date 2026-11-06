export const ERROR_CODES = [
  "bad_request",
  "unauthenticated",
  "invalid_credentials",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "setup_disabled",
  "payload_too_large",
  "internal",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ApiErrorBody = { error: { code: ErrorCode; message: string } };

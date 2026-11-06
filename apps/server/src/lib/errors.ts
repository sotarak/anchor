import type { ApiErrorBody, ErrorCode } from "@anchor/shared";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../env";
import { log } from "./log";

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Deployment misconfiguration (e.g. a malformed root key). Never exposed to clients. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Stored data failed an integrity check (e.g. AEAD tag mismatch). Never exposed to clients. */
export class IntegrityError extends Error {
  constructor(
    message: string,
    readonly fields: Record<string, unknown>,
  ) {
    super(message);
    this.name = "IntegrityError";
  }
}

function body(code: ErrorCode, message: string): ApiErrorBody {
  return { error: { code, message } };
}

export function errorHandler(err: Error, c: Context<AppEnv>): Response {
  if (err instanceof ApiError) {
    return c.json(body(err.code, err.message), err.status);
  }
  if (err instanceof ConfigError) {
    log("error", "config_error", { reason: err.message });
  } else if (err instanceof IntegrityError) {
    log("error", "secret_decrypt_failed", err.fields);
  } else {
    // Never log err.message: it can contain user input.
    log("error", "unhandled_error", { name: err.name });
  }
  return c.json(body("internal", "Internal error"), 500);
}

export function notFoundHandler(c: Context<AppEnv>): Response {
  return c.json(body("not_found", "Route not found"), 404);
}

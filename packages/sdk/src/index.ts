/**
 * @anchor-secrets/sdk: a Node client that reads secrets from an Anchor server
 * (spec 2026-11-07-v0.4.0-sdk-nestjs). This file only re-exports the public API.
 */
export { createAnchorClient } from "./client.js";
export { AnchorError } from "./errors.js";
export type {
  AnchorClient,
  AnchorEvent,
  AnchorSecret,
  AnchorValue,
  AnchorValueType,
  ClientOptions,
  ListQuery,
  RetryOptions,
} from "./types.js";

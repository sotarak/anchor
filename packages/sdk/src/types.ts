/** Public types of the SDK. They never come from `@anchor/shared`, which is bundled. */

/** The value type a secret declares. */
export type AnchorValueType = "string" | "json" | "pem" | "number" | "boolean" | "list";

/** A decoded secret value, as `loadSecrets` returns it. */
export type AnchorValue = string | number | boolean | unknown[] | Record<string, unknown>;

/** One secret, with its value as the server returned it (a string). */
export type AnchorSecret = {
  key: string;
  path: string;
  type: AnchorValueType;
  sensitive: boolean;
  version: number;
  value: string;
  /** Set when the secret comes from a folder this folder imports. */
  importedFrom?: { environment: string; path: string };
};

export type ClientOptions = {
  /** Base URL of the Anchor server. Defaults to `ANCHOR_API_URL`. */
  apiUrl?: string;
  /** A service token or another bearer Anchor accepts. Defaults to `ANCHOR_TOKEN`. */
  token?: string;
  /** Replaces the global `fetch`, for proxies and tests. */
  fetch?: typeof fetch;
  /** Per attempt; default 10 000 ms. */
  timeoutMs?: number;
};

export type ListQuery = {
  /** Project slug. */
  project: string;
  /** Environment slug. */
  environment: string;
  /** Folder path; default `/`. */
  path?: string;
  /** Expand `${...}` references; default `true`, like `anchor run`. */
  expand?: boolean;
  /** Add the secrets of the folder's imports; default `true`, like `anchor run`. */
  includeImports?: boolean;
};

export interface AnchorClient {
  /** The secrets of one folder, with values. */
  listSecrets(query: ListQuery): Promise<AnchorSecret[]>;
  /** The same secrets as `{ KEY: value }`, with typed values decoded. */
  loadSecrets(query: ListQuery): Promise<Record<string, AnchorValue>>;
}

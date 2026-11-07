/** Public types of the SDK. They never come from `@anchor/shared`, which is bundled. */
import type { AnchorError } from "./errors.js";

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
  /** Retries of network errors, timeouts and HTTP 429/502/503/504; `false` turns them off. */
  retry?: RetryOptions | false;
  /** Receives retries and failed refreshes. Exceptions it throws are ignored. */
  onEvent?: (event: AnchorEvent) => void;
};

export type RetryOptions = {
  /** Attempts in total, including the first; default 3. */
  attempts?: number;
  /** Upper bound of the first wait; it doubles per attempt. Default 250 ms. */
  baseDelayMs?: number;
  /** Upper bound of any wait, including `Retry-After`; default 5 000 ms. */
  maxDelayMs?: number;
};

/** What the client reports through `onEvent`. Never carries a token or a value. */
export type AnchorEvent =
  | { type: "retry"; attempt: number; delayMs: number; error: AnchorError }
  | { type: "refresh_failed"; error: AnchorError; staleForMs: number };

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

/** What the cache keeps per folder. `secrets` hold plaintext values. */
export type CacheEntry = { secrets: AnchorSecret[]; fetchedAt: number };

/**
 * Where cached folders live; the default keeps them in memory. A custom store (a file, Redis)
 * receives plaintext values and must protect them, for example by encrypting them.
 */
export interface CacheStore {
  get(key: string): CacheEntry | undefined | Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): void | Promise<void>;
}

export type CacheOptions = {
  /** How long a fetched folder is served without asking the server; default 60 000 ms. */
  ttlMs?: number;
  /** How long past `ttlMs` a folder may still be served when the server fails; default no limit. */
  maxStaleMs?: number;
  /** Default: an in-memory store per client. */
  store?: CacheStore;
};

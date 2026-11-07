import type { InstanceRole } from "@anchor/shared";
import type { ReencryptMessage } from "./keys/rotation";

export type Bindings = {
  DB: D1Database;
  /** Static assets (the dashboard build); the Worker itself only serves /api/*. */
  ASSETS: Fetcher;
  ANCHOR_ROOT_KEY: string;
  /** Id stored with every KEK wrapped by ANCHOR_ROOT_KEY. Default "rk1". */
  ANCHOR_ROOT_KEY_ID?: string;
  /** During root key rotation only: the old key, accepted for unwrapping until rewrap. */
  ANCHOR_ROOT_KEY_PREVIOUS?: string;
  ANCHOR_ROOT_KEY_PREVIOUS_ID?: string;
  /** Queue anchor-reencrypt: KEK rotation batches (src/keys/queue.ts consumes it). */
  REENCRYPT_QUEUE: Queue<ReencryptMessage>;
};

export type UserPrincipal = {
  type: "user";
  userId: string;
  email: string;
  name: string;
  role: InstanceRole;
  sessionId: string;
};

export type ServiceTokenPrincipal = {
  type: "service_token";
  tokenId: string;
  projectId: string;
  name: string;
  permission: "read" | "read-write";
  scopes: { environmentId: string; path: string }[];
  expiresAt: number;
};

/** Who is calling (spec §13.2). Every route resolves one before touching data. */
export type Principal = UserPrincipal | ServiceTokenPrincipal;

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    principal?: Principal;
    authVia?: "cookie" | "bearer";
    requestId: string;
    clientIp: string | null;
    userAgent: string | null;
  };
};

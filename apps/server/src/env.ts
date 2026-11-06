import type { InstanceRole } from "@anchor/shared";

export type Bindings = {
  DB: D1Database;
  ANCHOR_ROOT_KEY: string;
  ANCHOR_SETUP_TOKEN?: string;
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

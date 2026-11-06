export type Bindings = {
  DB: D1Database;
  ANCHOR_ROOT_KEY: string;
  ANCHOR_SETUP_TOKEN?: string;
};

export type Principal = {
  type: "user";
  userId: string;
  email: string;
  name: string;
  role: "owner" | "admin" | "member";
  sessionId: string;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: { principal?: Principal; authVia?: "cookie" | "bearer" };
};

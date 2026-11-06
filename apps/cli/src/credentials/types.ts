import { z } from "zod";

export type { Spawner } from "../context";

export const SERVICE_NAME = "anchor-cli";

const storedCredentialSchema = z.object({
  apiUrl: z.string().min(1),
  token: z.string().min(1),
  email: z.string(),
  expiresAt: z.number(),
});

export type StoredCredential = z.infer<typeof storedCredentialSchema>;

export interface CredentialStore {
  readonly kind: "macos-keychain" | "secret-service" | "file";
  get(apiUrl: string): Promise<StoredCredential | null>;
  set(c: StoredCredential): Promise<void>;
  delete(apiUrl: string): Promise<void>;
}

/** base64url(JSON): safe to place inside a quoted `security -i` command line. */
export function encodeCredential(c: StoredCredential): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

export function parseCredential(value: unknown): StoredCredential | null {
  const parsed = storedCredentialSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function decodeCredential(s: string): StoredCredential | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    return parseCredential(JSON.parse(Buffer.from(s, "base64url").toString("utf8")));
  } catch {
    return null;
  }
}

/** First stderr line of a helper, with the encoded secret (if any) redacted. */
export function helperMessage(stderr: string, secret?: string): string {
  const line = stderr.split("\n").find((l) => l.trim() !== "") ?? "unknown error";
  return secret ? line.split(secret).join("[redacted]").trim() : line.trim();
}

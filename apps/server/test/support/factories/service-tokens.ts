import { api, json, jsonInit } from "../http";
import { createUserWithSession } from "./users";

/**
 * Creates a service token through the real API as a fresh instance owner.
 * Returns the one-time token string and the token's id.
 */
export async function createServiceToken(
  projectSlug: string,
  opts: {
    permission: "read" | "read-write";
    scopes: { environment: string; path: string }[];
    expiresInDays?: number;
    name?: string;
  },
): Promise<{ token: string; id: string }> {
  const owner = await createUserWithSession({ role: "owner", kind: "cli" });
  const res = await api(
    `/api/v1/projects/${projectSlug}/service-tokens`,
    jsonInit(
      "POST",
      {
        name: opts.name ?? "ci",
        permission: opts.permission,
        scopes: opts.scopes,
        expiresInDays: opts.expiresInDays ?? 30,
      },
      { token: owner.token },
    ),
  );
  if (res.status !== 201) throw new Error(`createServiceToken: HTTP ${res.status}`);
  const body = await json<{ token: string; serviceToken: { id: string } }>(res);
  return { token: body.token, id: body.serviceToken.id };
}

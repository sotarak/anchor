import { env } from "cloudflare:workers";
import { toBase64Url, utf8Encode } from "#src/lib/encoding";
import type { OAuthScope } from "#src/oauth/scopes";
import { createGrant, issueCode, issueTokenPair, registerClient } from "#src/oauth/store";
import { api } from "./http";

export const REDIRECT = "http://localhost:33418/callback";
export const VERIFIER = "v".repeat(43);

export async function challengeFor(verifier: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8Encode(verifier))));
}

export async function oauthClient(redirectUris = [REDIRECT], name = "Claude Code") {
  return registerClient(env.DB, { name, redirectUris, ip: null, now: Date.now() });
}

/** A client, a grant for the user and a code bound to VERIFIER and REDIRECT. */
export async function oauthCode(
  userId: string,
  scopes: OAuthScope[] = ["secrets:read", "secrets:write"],
) {
  const client = await oauthClient();
  const now = Date.now();
  const grantId = await createGrant(env.DB, { userId, clientId: client.id, scopes, now });
  const code = await issueCode(env.DB, {
    grantId,
    redirectUri: REDIRECT,
    codeChallenge: await challengeFor(VERIFIER),
    now,
  });
  return { clientId: client.id, grantId, code };
}

/** An access token for the user with these scopes, straight from the store. */
export async function oauthTokenFor(
  userId: string,
  scopes: OAuthScope[] = ["secrets:read", "secrets:write"],
): Promise<string> {
  const client = await oauthClient();
  const now = Date.now();
  const grantId = await createGrant(env.DB, { userId, clientId: client.id, scopes, now });
  return (await issueTokenPair(env.DB, grantId, now)).accessToken;
}

export function formPost(path: string, params: Record<string, string>): Promise<Response> {
  return api(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
}

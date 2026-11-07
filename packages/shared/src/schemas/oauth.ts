import { z } from "zod";

/** OAuth scopes for MCP clients (spec 2026-11-07-v0.4.0-mcp-oauth). */
export const OAUTH_SCOPES = ["secrets:read", "secrets:write", "secrets:reveal"] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

/**
 * The authorization request as the dashboard forwards it from /oauth/authorize. Fields stay loose
 * strings: the server turns bad values into an OAuth error redirect, not a 400 body.
 */
export const oauthAuthorizeRequestSchema = z.object({
  response_type: z.string().max(100).optional(),
  client_id: z.string().max(200),
  redirect_uri: z.string().max(2000),
  code_challenge: z.string().max(200).optional(),
  code_challenge_method: z.string().max(100).optional(),
  scope: z.string().max(1000).optional(),
  state: z.string().max(2000).optional(),
  resource: z.string().max(2000).optional(),
});
export type OAuthAuthorizeRequest = z.infer<typeof oauthAuthorizeRequestSchema>;

export const oauthDecisionBodySchema = oauthAuthorizeRequestSchema.extend({
  approve: z.boolean(),
  allowReveal: z.boolean(),
});
export type OAuthDecisionBody = z.infer<typeof oauthDecisionBodySchema>;

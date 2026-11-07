-- 0008: OAuth 2.1 authorization server for MCP clients (spec 2026-11-07-v0.4.0-mcp-oauth).
-- Codes and tokens are stored as sha256 hex only; a table dump cannot be replayed.

-- Public clients from dynamic registration (RFC 7591). A client without grants is "pending" and
-- purged after 24 hours.
CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL, -- JSON array of strings
  ip TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX oauth_clients_created ON oauth_clients(created_at);

-- One approval by one user of one client, with the scopes granted. Revoking it ends every code
-- and token issued under it.
CREATE TABLE oauth_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  scopes TEXT NOT NULL, -- space-separated
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX oauth_grants_user ON oauth_grants(user_id);
CREATE INDEX oauth_grants_client ON oauth_grants(client_id);

CREATE TABLE oauth_codes (
  id TEXT PRIMARY KEY, -- sha256Hex(code)
  grant_id TEXT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX oauth_codes_grant ON oauth_codes(grant_id);

CREATE TABLE oauth_tokens (
  id TEXT PRIMARY KEY, -- sha256Hex(token)
  grant_id TEXT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('access','refresh')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER -- refresh tokens: set when rotated
);
CREATE INDEX oauth_tokens_grant ON oauth_tokens(grant_id);
CREATE INDEX oauth_tokens_expires ON oauth_tokens(expires_at);

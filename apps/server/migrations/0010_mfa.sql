-- 0010 (0.6.0): two-factor authentication and passkeys (spec 2026-11-22-v0.6.0-mfa).
-- Additive: the running 0.5.x version never reads these tables or the new column.

-- Last password or second-factor proof of a dashboard session (ms); NULL for CLI sessions.
-- MFA changes need one within the last 10 minutes.
ALTER TABLE sessions ADD COLUMN reauth_at INTEGER;

-- One authenticator app per user. The secret is AES-256-GCM sealed by the root key named in
-- root_key_id, with AAD "anchor/totp/v1|<user_id>". confirmed_at NULL = enrollment pending.
CREATE TABLE totp_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  root_key_id TEXT NOT NULL,
  iv BLOB NOT NULL,
  secret_ct BLOB NOT NULL,
  confirmed_at INTEGER,
  last_step INTEGER,                -- last accepted 30 s time step; earlier or equal ones are refused
  created_at INTEGER NOT NULL
);

-- Single-use recovery codes, SHA-256 of the normalized code.
CREATE TABLE recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, code_hash)
);

-- Passkeys (WebAuthn second factor). Each works only on the hostname (rp_id) it was created on.
CREATE TABLE webauthn_credentials (
  id TEXT PRIMARY KEY,              -- credential id, base64url
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rp_id TEXT NOT NULL,
  public_key BLOB NOT NULL,         -- COSE public key
  counter INTEGER NOT NULL,
  transports TEXT,                  -- JSON array or NULL
  name TEXT NOT NULL,
  backed_up INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX webauthn_credentials_user ON webauthn_credentials (user_id);

-- A password login waiting for its second factor. The ticket itself is never stored.
CREATE TABLE mfa_tickets (
  id TEXT PRIMARY KEY,              -- sha256Hex(ticket)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client TEXT NOT NULL CHECK (client IN ('web','cli')),
  failures INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX mfa_tickets_expires ON mfa_tickets (expires_at);

-- Outstanding WebAuthn challenges: single use, owned by a login ticket or a dashboard session.
CREATE TABLE webauthn_challenges (
  id TEXT PRIMARY KEY,              -- the challenge, base64url
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('login','register','reauth')),
  ticket_id TEXT REFERENCES mfa_tickets(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX webauthn_challenges_expires ON webauthn_challenges (expires_at);

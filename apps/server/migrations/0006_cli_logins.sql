-- 0006: CLI login through the browser (spec 2026-11-07-v0.4.0-cli-browser-login).
CREATE TABLE cli_logins (
  id TEXT PRIMARY KEY,                -- sha256Hex(deviceCode); the device code is never stored
  user_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','denied','consumed')),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  client_name TEXT,
  user_agent TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_polled_at INTEGER
);
CREATE INDEX cli_logins_expires ON cli_logins(expires_at);

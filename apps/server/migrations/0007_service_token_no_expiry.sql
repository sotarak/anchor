-- Service tokens may have no expiry (0.4.0): expires_at becomes nullable, NULL = never expires.
-- SQLite cannot drop NOT NULL in place, so the table is rebuilt and every row copied.
PRAGMA defer_foreign_keys = on;

CREATE TABLE service_tokens_new (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (permission IN ('read','read-write')),
  scopes TEXT NOT NULL, -- JSON [{environmentId, path}]
  created_by TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER, -- NULL = never expires
  last_used_at INTEGER,
  revoked_at INTEGER
);

INSERT INTO service_tokens_new (id, project_id, name, token_hash, token_prefix, permission, scopes,
  created_by, created_at, expires_at, last_used_at, revoked_at)
SELECT id, project_id, name, token_hash, token_prefix, permission, scopes,
  created_by, created_at, expires_at, last_used_at, revoked_at
FROM service_tokens;

DROP TABLE service_tokens;

ALTER TABLE service_tokens_new RENAME TO service_tokens;

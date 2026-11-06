-- M2: users can be disabled; invites, password resets, project memberships, service tokens,
-- and an append-only audit log (spec §13.3).

ALTER TABLE users ADD COLUMN disabled_at INTEGER;

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  accepted_at INTEGER,
  revoked_at INTEGER
);

CREATE TABLE password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin','developer','viewer')),
  environment_ids TEXT, -- JSON array of environment ids; NULL means every environment
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX project_members_user ON project_members(user_id);

CREATE TABLE service_tokens (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (permission IN ('read','read-write')),
  scopes TEXT NOT NULL, -- JSON [{environmentId, path}]
  created_by TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);

-- No foreign keys: rows must survive deletes of what they describe.
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user','service_token','anonymous')),
  actor_id TEXT,
  actor_label TEXT,
  action TEXT NOT NULL,
  project_id TEXT,
  environment_id TEXT,
  target TEXT,
  ip TEXT,
  user_agent TEXT,
  request_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_events_at ON audit_events(at DESC, id);
CREATE INDEX audit_events_project ON audit_events(project_id, at DESC);

CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;

CREATE TRIGGER audit_events_retention BEFORE DELETE ON audit_events
WHEN old.at > (CAST(strftime('%s','now') AS INTEGER) * 1000 - 31536000000)
BEGIN SELECT RAISE(ABORT, 'audit_events within retention cannot be deleted'); END;

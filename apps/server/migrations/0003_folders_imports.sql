-- M5: explicit folders, folder imports, KEK status and key rotations (spec §13.3).

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (environment_id, path)
);

CREATE TABLE folder_imports (
  id TEXT PRIMARY KEY,
  environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  source_environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  source_path TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (environment_id, path, source_environment_id, source_path)
);

ALTER TABLE project_keys ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'retiring', 'retired'));

CREATE TABLE key_rotations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_version INTEGER NOT NULL,
  to_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  total INTEGER NOT NULL,
  done INTEGER NOT NULL,
  error TEXT,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE INDEX key_rotations_project ON key_rotations(project_id, started_at DESC);
CREATE INDEX secret_versions_key_version ON secret_versions(key_version);

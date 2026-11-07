-- 0005: per-version value type and sensitive flag (spec 2026-11-07-v0.4.0-typed-values).
-- Existing rows keep AAD format 1 and are always read as string + sensitive.
ALTER TABLE secret_versions ADD COLUMN value_type TEXT NOT NULL DEFAULT 'string'
  CHECK (value_type IN ('string','json','pem','number','boolean','list'));
ALTER TABLE secret_versions ADD COLUMN sensitive INTEGER NOT NULL DEFAULT 1 CHECK (sensitive IN (0,1));
ALTER TABLE secret_versions ADD COLUMN aad_format INTEGER NOT NULL DEFAULT 1 CHECK (aad_format IN (1,2));

/**
 * The retention trigger from migrations/0002_access.sql, verbatim. resetDb drops and re-creates it
 * so tests can empty audit_events; keep this byte-identical to the migration.
 */
export const AUDIT_RETENTION_TRIGGER_DDL = `CREATE TRIGGER audit_events_retention BEFORE DELETE ON audit_events
WHEN old.at > (CAST(strftime('%s','now') AS INTEGER) * 1000 - 31536000000)
BEGIN SELECT RAISE(ABORT, 'audit_events within retention cannot be deleted'); END;`;

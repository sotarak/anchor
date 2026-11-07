-- M5 fix: a KEK marked 'retired' must stay unused. A write that loaded the project before a
-- rotation finished would otherwise store a new version under the retired KEK (it encrypted with
-- the KEK that was current when it started). The insert is refused; the write fails with 409 and
-- the client retries under the current KEK.
CREATE TRIGGER secret_versions_reject_retired_kek
BEFORE INSERT ON secret_versions
WHEN EXISTS (
  SELECT 1 FROM project_keys pk JOIN secrets s ON s.project_id = pk.project_id
  WHERE s.id = NEW.secret_id AND pk.version = NEW.key_version AND pk.status = 'retired'
)
BEGIN
  SELECT RAISE(ABORT, 'retired_kek');
END;

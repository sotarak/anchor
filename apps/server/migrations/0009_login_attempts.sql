-- 0.5.3: password login is limited per (client address, submitted email) and per address,
-- instead of locking the account (which let anyone lock any user out). See
-- src/auth/login-attempts.ts. Additive: the running version never reads this table.
CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY,           -- "p|<addr>|<email>" or "i|<addr>"
  email TEXT,                     -- set on pair rows, so a password reset can clear them
  failures INTEGER NOT NULL,
  window_start INTEGER NOT NULL,  -- ms; the 15-minute counting window started here
  locked_until INTEGER            -- ms; attempts before this are refused and not counted
);
CREATE INDEX login_attempts_email ON login_attempts (email) WHERE email IS NOT NULL;

ALTER TABLE employees ADD COLUMN email TEXT COLLATE NOCASE;
ALTER TABLE employees ADD COLUMN lark_open_id TEXT;
ALTER TABLE employees ADD COLUMN lark_tenant_key TEXT;
CREATE UNIQUE INDEX employees_email_unique ON employees(email COLLATE NOCASE) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX employees_lark_unique ON employees(lark_tenant_key,lark_open_id) WHERE lark_open_id IS NOT NULL;
-- Legacy access codes remain only for migration compatibility and have no login route.
UPDATE employees SET code_hash='', auth_version=auth_version+1;
CREATE TABLE email_challenges (
 id TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE, code_hash TEXT NOT NULL,
 expires_at INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0,
 consumed_at INTEGER, ready INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX email_challenges_expiry ON email_challenges(expires_at);
CREATE TABLE oauth_states (
 state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);

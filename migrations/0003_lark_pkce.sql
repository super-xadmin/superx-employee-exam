ALTER TABLE oauth_states ADD COLUMN code_verifier TEXT;
DELETE FROM oauth_states;
-- Explicit administrator bindings replace automatic contact-email matching.
UPDATE employees SET lark_open_id=NULL,lark_tenant_key=NULL,auth_version=auth_version+1;

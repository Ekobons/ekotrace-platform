-- Security (BEEAH web application security standard): multi-factor authentication, single sign-on,
-- a tamper-evident audit log kept for its retention period, SIEM forwarding, secure deletion.

-- ------------------------------------------------------------ multi-factor --
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS mfa_secret      text;          -- encrypted (AES-256-GCM, server key)
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS mfa_pending     text;          -- secret being set up, encrypted
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS mfa_enabled_at  timestamptz;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS mfa_last_step   bigint;        -- last 30-second step used (no replay)
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS mfa_recovery    text[] NOT NULL DEFAULT '{}';  -- SHA-256 of unused recovery codes

ALTER TABLE tenant ADD COLUMN IF NOT EXISTS mfa_required boolean NOT NULL DEFAULT false;

-- How a session was opened; "enrol" = must set up MFA before anything else.
ALTER TABLE session ADD COLUMN IF NOT EXISTS method text NOT NULL DEFAULT 'password';
ALTER TABLE session ADD COLUMN IF NOT EXISTS mfa_enrol boolean NOT NULL DEFAULT false;

-- Password correct, second factor still to come (5 minutes, 5 tries).
CREATE TABLE IF NOT EXISTS login_challenge (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  attempts   int NOT NULL DEFAULT 0,
  ip         text
);

-- -------------------------------------------------------------- single sign-on --
CREATE TABLE IF NOT EXISTS sso_config (
  tenant_id     uuid PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  issuer        text NOT NULL,                 -- e.g. https://login.microsoftonline.com/<directory id>/v2.0
  client_id     text NOT NULL,
  client_secret text,                          -- encrypted (AES-256-GCM, server key)
  domains       text[] NOT NULL DEFAULT '{}',  -- email domains that sign in here
  enabled       boolean NOT NULL DEFAULT false,
  enforce       boolean NOT NULL DEFAULT false, -- no password sign-in (except super admins with MFA: break-glass)
  require_mfa   boolean NOT NULL DEFAULT true,  -- the identity provider must report MFA (amr = mfa)
  updated_by    text, updated_at timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  EXECUTE 'ALTER TABLE sso_config ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE sso_config FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON sso_config';
  EXECUTE $p$CREATE POLICY tenant_isolation ON sso_config
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$;
END $$;
CREATE INDEX IF NOT EXISTS sso_domain ON sso_config USING gin (domains);

-- A sign-in on its way to the identity provider and back (10 minutes).
CREATE TABLE IF NOT EXISTS sso_state (
  state_hash    text PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  nonce         text NOT NULL,
  code_verifier text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);

-- ------------------------------------------------------------- audit log --
-- Kept after a company is deleted (until its retention period ends).
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_tenant_id_fkey;
-- Sealed in a hash chain: each sealed row carries the hash of the one before, so a changed,
-- removed or inserted row breaks the chain (GET /api/platform/audit/verify).
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS seal_seq  bigint;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS prev_hash text;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS hash      text;
CREATE UNIQUE INDEX IF NOT EXISTS audit_log_seal ON audit_log (seal_seq) WHERE seal_seq IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_log_unsealed ON audit_log (id) WHERE seal_seq IS NULL;

CREATE TABLE IF NOT EXISTS audit_chain (
  id          int PRIMARY KEY CHECK (id = 1),
  last_seq    bigint NOT NULL DEFAULT 0,
  last_hash   text NOT NULL DEFAULT repeat('0', 64),
  -- after old rows are removed at the end of their retention period, the chain starts here
  first_seq   bigint NOT NULL DEFAULT 1,
  anchor_hash text NOT NULL DEFAULT repeat('0', 64),
  purged_through timestamptz
);
INSERT INTO audit_chain (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION audit_row_hash(r audit_log, prev text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(concat_ws('|', r.id::text, coalesce(r.tenant_id::text, ''), coalesce(r.user_id::text, ''), coalesce(r.user_name, ''),
    (extract(epoch FROM r.at) * 1000000)::bigint::text, r.action, coalesce(r.entity, ''), coalesce(r.entity_id, ''), coalesce(r.detail::text, ''), coalesce(r.ip, ''),
    r.seal_seq::text, prev), 'UTF8')), 'hex')
$$;

-- Seal every unsealed row, in the order they were written. Returns how many.
CREATE OR REPLACE FUNCTION audit_seal() RETURNS int LANGUAGE plpgsql AS $$
DECLARE ch audit_chain; r audit_log; n int := 0; h text;
BEGIN
  PERFORM set_config('app.platform', 'on', true);
  SELECT * INTO ch FROM audit_chain WHERE id = 1 FOR UPDATE;
  FOR r IN SELECT * FROM audit_log WHERE seal_seq IS NULL ORDER BY id LOOP
    ch.last_seq := ch.last_seq + 1;
    r.seal_seq := ch.last_seq;
    h := audit_row_hash(r, ch.last_hash);
    PERFORM set_config('app.audit_seal', 'on', true);
    UPDATE audit_log SET seal_seq = ch.last_seq, prev_hash = ch.last_hash, hash = h WHERE id = r.id;
    PERFORM set_config('app.audit_seal', 'off', true);
    ch.last_hash := h; n := n + 1;
  END LOOP;
  UPDATE audit_chain SET last_seq = ch.last_seq, last_hash = ch.last_hash WHERE id = 1;
  RETURN n;
END $$;

-- Append-only: nothing changes a row (except sealing it once); rows go only at the end of retention.
CREATE OR REPLACE FUNCTION audit_log_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF current_setting('app.audit_seal', true) = 'on' AND OLD.seal_seq IS NULL
       AND (OLD.id, OLD.tenant_id, OLD.user_id, OLD.user_name, OLD.at, OLD.action, OLD.entity, OLD.entity_id, OLD.detail, OLD.ip)
           IS NOT DISTINCT FROM (NEW.id, NEW.tenant_id, NEW.user_id, NEW.user_name, NEW.at, NEW.action, NEW.entity, NEW.entity_id, NEW.detail, NEW.ip) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'The audit log cannot be changed' USING ERRCODE = 'EKAUD';
  ELSIF TG_OP = 'DELETE' THEN
    IF current_setting('app.audit_purge', true) = 'on' AND OLD.at < now() - interval '12 months' AND OLD.seal_seq IS NOT NULL THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'The audit log cannot be deleted (kept for at least 12 months)' USING ERRCODE = 'EKAUD';
  END IF;
  RAISE EXCEPTION 'The audit log cannot be emptied' USING ERRCODE = 'EKAUD';
END $$;
DROP TRIGGER IF EXISTS audit_log_guard ON audit_log;
CREATE TRIGGER audit_log_guard BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_guard();
DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION audit_log_guard();

-- Remove rows older than the retention period (never less than 12 months); the chain restarts after them.
CREATE OR REPLACE FUNCTION audit_purge(months int) RETURNS int LANGUAGE plpgsql AS $$
DECLARE cut timestamptz := now() - make_interval(months => greatest(months, 12)); last audit_log; n int;
BEGIN
  PERFORM set_config('app.platform', 'on', true);
  PERFORM audit_seal();
  SELECT * INTO last FROM audit_log WHERE at < cut AND seal_seq IS NOT NULL ORDER BY seal_seq DESC LIMIT 1;
  IF last.id IS NULL THEN RETURN 0; END IF;
  PERFORM set_config('app.audit_purge', 'on', true);
  DELETE FROM audit_log WHERE seal_seq <= last.seal_seq;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('app.audit_purge', 'off', true);
  UPDATE audit_chain SET first_seq = last.seal_seq + 1, anchor_hash = last.hash, purged_through = last.at WHERE id = 1;
  RETURN n;
END $$;

-- Where the SIEM forwarder has got to.
CREATE TABLE IF NOT EXISTS siem_cursor (name text PRIMARY KEY, last_seq bigint NOT NULL DEFAULT 0, last_error text, updated_at timestamptz NOT NULL DEFAULT now());

-- ------------------------------------------------------------ secure deletion --
-- Platform record that a company's data was destroyed (the company row itself is gone).
CREATE TABLE IF NOT EXISTS destruction_certificate (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  company       text NOT NULL,
  country       text,
  requested_by  text NOT NULL,
  reason        text,
  performed_at  timestamptz NOT NULL DEFAULT now(),
  rows_deleted  jsonb NOT NULL,     -- table → rows
  files_deleted int NOT NULL,
  export_sha256 text,               -- manifest of the export handed back before deletion
  backups_until date,               -- encrypted backups holding copies expire by this date
  audit_until   date               -- the company's audit records are removed after this date
);

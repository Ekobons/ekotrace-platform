-- Automatic account sync from the company's identity provider (SCIM 2.0), security alerts,
-- and sign-in of platform administrators through Ekobon's own identity provider.

-- ----------------------------------------------------------------------- SCIM --
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS external_id  text;
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS scim_managed boolean NOT NULL DEFAULT false;  -- role and access come from the identity provider
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS scim_active  boolean NOT NULL DEFAULT true;   -- active in the identity provider

-- One token per company, used by the identity provider (only its SHA-256 is kept).
CREATE TABLE IF NOT EXISTS scim_token (
  tenant_id    uuid PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  prefix       text NOT NULL,
  default_role text CHECK (default_role IN ('verifier')),   -- people in no mapped group: NULL = no access
  created_by   text, created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz
);
-- Groups as the identity provider sends them; the super admin maps each to a role.
CREATE TABLE IF NOT EXISTS scim_group (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  display_name  text NOT NULL,
  external_id   text,
  role          text CHECK (role IN ('super_admin', 'admin', 'manager', 'preparer', 'verifier')),
  scope_node_id uuid REFERENCES org_node(id) ON DELETE SET NULL,   -- admin: the sub-group they run
  facility_ids  uuid[] NOT NULL DEFAULT '{}',                       -- manager / preparer: their facilities
  created_at    timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS scim_group_name ON scim_group (tenant_id, lower(display_name));
CREATE TABLE IF NOT EXISTS scim_member (
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  group_id  uuid NOT NULL REFERENCES scim_group(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

-- --------------------------------------------------------------------- alerts --
-- Raised from audit records by rules (a burst of failed sign-ins, MFA switched off, a full export…).
-- tenant_id NULL = a platform alert. Kept after a company is deleted, like the audit log.
CREATE TABLE IF NOT EXISTS security_alert (
  id        bigserial PRIMARY KEY,
  tenant_id uuid,
  rule      text NOT NULL,
  severity  text NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  title     text NOT NULL,
  detail    jsonb,
  dedup     text,                                  -- one alert per key per hour
  at        timestamptz NOT NULL DEFAULT now(),
  seq       bigint,                                -- the audit record that raised it
  ack_by    text, ack_at timestamptz, ack_note text
);
CREATE INDEX IF NOT EXISTS security_alert_tenant ON security_alert (tenant_id, at DESC);
CREATE INDEX IF NOT EXISTS security_alert_dedup ON security_alert (dedup, at DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['scim_token', 'scim_group', 'scim_member'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;
ALTER TABLE security_alert ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_alert FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON security_alert;
CREATE POLICY tenant_isolation ON security_alert
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on');

-- ------------------------------------------------------- platform admin sign-in --
-- A sign-in through Ekobon's identity provider has no company.
ALTER TABLE sso_state ALTER COLUMN tenant_id DROP NOT NULL;

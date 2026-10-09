-- =============================================================================
-- 003 — Organisation tree, people, login sessions, audit log, company settings
--
--   org_node     the company's structure: one main entity (group) → sub-groups →
--                facilities. Replaces the flat "facility" table (existing
--                facilities become facilities under a group named after the company).
--   app_user     people who log in. tenant_id NULL = Ekobon platform staff.
--   user_facility facilities a Manager or Data preparer works on.
--   session      login sessions (only a hash of the browser's token is stored).
--   audit_log    who changed what, when (security & audit log, assurance).
-- =============================================================================

-- ---- company settings --------------------------------------------------------
ALTER TABLE tenant
  ADD COLUMN plan            text NOT NULL DEFAULT 'enterprise' CHECK (plan IN ('trial','starter','professional','enterprise')),
  ADD COLUMN status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  ADD COLUMN access_start    date NOT NULL DEFAULT current_date,
  ADD COLUMN access_expiry   date NOT NULL DEFAULT (current_date + interval '1 year')::date,
  ADD COLUMN consolidation   text NOT NULL DEFAULT 'operational' CHECK (consolidation IN ('operational','financial','equity')),
  ADD COLUMN base_year       int  NOT NULL DEFAULT 2025 CHECK (base_year BETWEEN 2000 AND 2100),
  ADD COLUMN notes           text;

-- ---- organisation tree ---------------------------------------------------------
ALTER TABLE facility RENAME TO org_node;
ALTER INDEX facility_tenant RENAME TO org_node_tenant;
ALTER TABLE org_node
  ADD COLUMN kind                text NOT NULL DEFAULT 'facility' CHECK (kind IN ('group','subgroup','facility')),
  ADD COLUMN parent_id           uuid REFERENCES org_node(id),
  ADD COLUMN facility_type       text,            -- Office, Plant, Warehouse, Fleet depot, Data centre…
  ADD COLUMN location            text,
  ADD COLUMN floor_area_m2       numeric(14,2) CHECK (floor_area_m2 >= 0),
  ADD COLUMN employees           int CHECK (employees >= 0),
  ADD COLUMN ownership_pct       numeric(5,2) NOT NULL DEFAULT 100 CHECK (ownership_pct BETWEEN 0 AND 100),
  ADD COLUMN operational_control boolean NOT NULL DEFAULT true,
  ADD COLUMN financial_control   boolean NOT NULL DEFAULT true,
  ADD COLUMN sort                int NOT NULL DEFAULT 100,
  ADD COLUMN created_at          timestamptz NOT NULL DEFAULT now();
CREATE INDEX org_node_parent ON org_node(parent_id);
-- Exactly one main entity per company.
CREATE UNIQUE INDEX org_node_one_group ON org_node(tenant_id) WHERE kind = 'group';

-- Existing companies: create the main entity and hang existing facilities under it.
DO $$
DECLARE t record; g uuid;
BEGIN
  PERFORM set_config('app.platform', 'on', true);
  FOR t IN SELECT id, name, country FROM tenant LOOP
    INSERT INTO org_node (tenant_id, name, country, kind) VALUES (t.id, t.name, t.country, 'group') RETURNING id INTO g;
    UPDATE org_node SET parent_id = g WHERE tenant_id = t.id AND kind = 'facility';
  END LOOP;
END $$;
ALTER TABLE org_node ADD CONSTRAINT org_node_parent_rule CHECK ((kind = 'group') = (parent_id IS NULL));

-- ---- people ----------------------------------------------------------------------
CREATE TABLE app_user (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid REFERENCES tenant(id) ON DELETE CASCADE,   -- NULL = platform staff
  email                text NOT NULL,
  name                 text NOT NULL,
  role                 text NOT NULL CHECK (role IN ('platform_admin','super_admin','admin','manager','preparer','verifier')),
  scope_node_id        uuid REFERENCES org_node(id),                   -- Admin: the sub-group they run
  password_hash        text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  disabled             boolean NOT NULL DEFAULT false,
  failed_logins        int NOT NULL DEFAULT 0,
  locked_until         timestamptz,
  last_login_at        timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid,
  CHECK ((role = 'platform_admin') = (tenant_id IS NULL)),
  CHECK (role <> 'admin' OR scope_node_id IS NOT NULL)
);
CREATE UNIQUE INDEX app_user_email ON app_user (lower(email));
CREATE INDEX app_user_tenant ON app_user(tenant_id);

ALTER TABLE org_node ADD COLUMN manager_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL;

CREATE TABLE user_facility (
  user_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  node_id    uuid NOT NULL REFERENCES org_node(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, node_id)
);

CREATE TABLE session (
  token_hash   text PRIMARY KEY,                -- sha256 of the cookie value
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip           text,
  user_agent   text
);
CREATE INDEX session_by_user ON session(user_id);

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  tenant_id  uuid REFERENCES tenant(id) ON DELETE CASCADE,  -- NULL = platform-level action
  user_id    uuid,
  user_name  text,
  at         timestamptz NOT NULL DEFAULT now(),
  action     text NOT NULL,                     -- 'login', 'user.create', 'node.update', 'activity.create'…
  entity     text,
  entity_id  text,
  detail     jsonb,
  ip         text
);
CREATE INDEX audit_log_tenant_at ON audit_log(tenant_id, at DESC);

-- Activities and results point at a facility node (unchanged column name facility_id).
-- Row-level security for the new client tables (same rule as 001).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['app_user','user_facility','audit_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
             OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
             OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;
-- Sessions are only touched by the login code, which runs as platform.
ALTER TABLE session ENABLE ROW LEVEL SECURITY;
ALTER TABLE session FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_only ON session USING (current_setting('app.platform', true) = 'on') WITH CHECK (current_setting('app.platform', true) = 'on');

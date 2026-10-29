-- EKOTRACE SME (a package of its own: tenant.products 'sme') and the SME network ('smenet').
--
--   sme      the India SME tool: one company = one SME; it signs in at /sme and sees only SME screens
--   smenet   SME network: a listed buyer, an industry cluster, a bank or a CA firm that SMEs share data with
--
--   sme_doc        each SME module's inputs for one financial year (one JSON document per module)
--   sme_result     the figures calculated from them (kept up to date on every save; read by partners with consent)
--   sme_company    per-SME settings that are not per year (worker grievance QR token)
--   sme_scrap      scrap and waste listed for sale
--   sme_grievance  worker grievances sent through the QR page (anonymous)
--   sme_credit     solar and efficiency projects offered to the pooled carbon-credit programme
--   sme_partner    what kind of partner a 'smenet' company is (buyer, cluster, bank, CA firm)
--   sme_link       an SME and a partner; data flows only while the SME has sharing switched on
--   sme_ca_request an SME asking for its SRMM / readiness self-assessment to be validated by a CA firm
--   sme_setting    platform settings (factors, rules, SRMM banks …), versioned; one active version per key
--   sme_signup     self-service sign-up waiting for e-mail confirmation
SELECT set_config('app.platform', 'on', true);

ALTER TABLE tenant DROP CONSTRAINT IF EXISTS tenant_products_check;
ALTER TABLE tenant ADD CONSTRAINT tenant_products_check CHECK (products <@ ARRAY['ekotrace', 'ekofin', 'cbam', 'ccts', 'brsr', 'uaemrv', 'energy', 'compliance', 'epr', 'sme', 'smenet']::text[] AND cardinality(products) >= 1);

CREATE TABLE IF NOT EXISTS sme_doc (
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  fy            text NOT NULL CHECK (fy ~ '^FY [0-9]{4}-[0-9]{2}$'),
  module        text NOT NULL CHECK (module ~ '^[a-z_]{2,30}$'),
  data          jsonb NOT NULL DEFAULT '{}' CHECK (octet_length(data::text) <= 100000),
  version       int NOT NULL DEFAULT 1,
  updated_name  text, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, fy, module)
);

CREATE TABLE IF NOT EXISTS sme_result (
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  fy            text NOT NULL,
  scope1        numeric NOT NULL DEFAULT 0, scope2 numeric NOT NULL DEFAULT 0, scope3 numeric NOT NULL DEFAULT 0,
  intensity     numeric NOT NULL DEFAULT 0,
  esg_pct       numeric NOT NULL DEFAULT 0, esg_level int NOT NULL DEFAULT 0,
  srmm_pct      numeric NOT NULL DEFAULT 0, srmm_level int NOT NULL DEFAULT 0, srmm_version text,
  cbam_see      numeric,
  savings_inr   numeric NOT NULL DEFAULT 0,
  solar_kw      numeric NOT NULL DEFAULT 0,
  pf_flagged    boolean NOT NULL DEFAULT false,
  bench_consent boolean NOT NULL DEFAULT false,
  industry      text, state text, sector text,
  sources       jsonb NOT NULL DEFAULT '[]',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, fy)
);

CREATE TABLE IF NOT EXISTS sme_company (
  tenant_id        uuid PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  sector           text NOT NULL DEFAULT 'mfg' CHECK (sector IN ('mfg', 'svc')),
  industry         text NOT NULL DEFAULT '' CHECK (length(industry) <= 160),
  state            text NOT NULL DEFAULT '' CHECK (length(state) <= 60),
  udyam_no         text CHECK (udyam_no IS NULL OR length(udyam_no) <= 40),
  grievance_token  text NOT NULL UNIQUE DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 16),
  is_example       boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sme_scrap (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  item        text NOT NULL CHECK (length(item) BETWEEN 2 AND 200),
  qty         numeric NOT NULL DEFAULT 0 CHECK (qty >= 0),
  unit        text NOT NULL DEFAULT 't' CHECK (unit IN ('t', 'kg', 'kL', 'L', 'nos')),
  price       numeric NOT NULL DEFAULT 0 CHECK (price >= 0),
  hazardous   boolean NOT NULL DEFAULT false,
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'listed', 'sold', 'withdrawn', 'blocked')),
  admin_note  text CHECK (admin_note IS NULL OR length(admin_note) <= 300),
  created_at  timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sme_grievance (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  category     text CHECK (category IS NULL OR length(category) <= 40),
  text         text NOT NULL CHECK (length(text) BETWEEN 5 AND 2000),
  language     text CHECK (language IS NULL OR length(language) <= 5),
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at   timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS sme_credit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  type            text NOT NULL CHECK (type IN ('solar', 'efficiency', 'fuel_switch')),
  capacity_kw     numeric CHECK (capacity_kw IS NULL OR capacity_kw >= 0),
  kwh_per_year    numeric CHECK (kwh_per_year IS NULL OR kwh_per_year >= 0),
  tco2e_per_year  numeric,
  status          text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'registered', 'issued', 'rejected')),
  created_name    text, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sme_partner (
  tenant_id   uuid PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('buyer', 'cluster', 'bank', 'ca_firm')),
  city        text NOT NULL DEFAULT '' CHECK (length(city) <= 80)
);

CREATE TABLE IF NOT EXISTS sme_link (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_tenant      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  sme_tenant          uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  share               boolean NOT NULL DEFAULT false,
  consent_at          timestamptz, revoked_at timestamptz,
  purchase_share_pct  numeric CHECK (purchase_share_pct IS NULL OR purchase_share_pct BETWEEN 0 AND 100),
  loan_cr             numeric CHECK (loan_cr IS NULL OR loan_cr >= 0),
  ev_cr               numeric CHECK (ev_cr IS NULL OR ev_cr >= 0),
  reminded_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_tenant, sme_tenant)
);

CREATE TABLE IF NOT EXISTS sme_ca_request (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sme_tenant       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  fy               text NOT NULL,
  srmm_version     text NOT NULL CHECK (srmm_version IN ('mfg', 'svc')),
  self_pct         numeric,
  status           text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'assigned', 'in_review', 'validated', 'rejected')),
  ca_tenant        uuid REFERENCES tenant(id) ON DELETE SET NULL,
  validated_pct    numeric, validated_level int,
  publish_on_icai  boolean NOT NULL DEFAULT false,
  notes            text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  reviewer_name    text,
  created_at       timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sme_ca_request_open ON sme_ca_request (sme_tenant, fy) WHERE status IN ('requested', 'assigned', 'in_review');

CREATE TABLE IF NOT EXISTS sme_setting (
  id            bigserial PRIMARY KEY,
  skey          text NOT NULL CHECK (skey ~ '^[a-z_]{2,40}$'),
  version       int NOT NULL,
  data          jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  note          text CHECK (note IS NULL OR length(note) <= 300),
  created_name  text, created_at timestamptz NOT NULL DEFAULT now(),
  activated_name text, activated_at timestamptz,
  UNIQUE (skey, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS sme_setting_active ON sme_setting (skey) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS sme_signup (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company      text NOT NULL, sector text NOT NULL, industry text NOT NULL DEFAULT '', state text NOT NULL DEFAULT '',
  name         text NOT NULL, email text NOT NULL, phone text,
  token_hash   text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  done_tenant  uuid REFERENCES tenant(id) ON DELETE SET NULL,
  ip           text, created_at timestamptz NOT NULL DEFAULT now()
);

-- Company rows: only that company (or platform staff) sees them.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['sme_doc', 'sme_result', 'sme_company', 'sme_scrap', 'sme_grievance', 'sme_credit', 'sme_partner'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

-- Links and validation requests: both sides see the row; partners read an SME's figures only through
-- the API, which checks that sharing is on.
ALTER TABLE sme_link ENABLE ROW LEVEL SECURITY; ALTER TABLE sme_link FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS two_sides ON sme_link;
CREATE POLICY two_sides ON sme_link
  USING (sme_tenant = nullif(current_setting('app.tenant_id', true), '')::uuid OR partner_tenant = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
  WITH CHECK (sme_tenant = nullif(current_setting('app.tenant_id', true), '')::uuid OR partner_tenant = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on');
ALTER TABLE sme_ca_request ENABLE ROW LEVEL SECURITY; ALTER TABLE sme_ca_request FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS two_sides ON sme_ca_request;
CREATE POLICY two_sides ON sme_ca_request
  USING (sme_tenant = nullif(current_setting('app.tenant_id', true), '')::uuid OR ca_tenant = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
  WITH CHECK (sme_tenant = nullif(current_setting('app.tenant_id', true), '')::uuid OR ca_tenant = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on');

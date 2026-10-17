-- CBAM — EU Carbon Border Adjustment Mechanism (Regulation (EU) 2023/956; definitive period from 1 January 2026;
-- monitoring and reporting by Implementing Regulation (EU) 2025/2547, default values (EU) 2025/2621, free allocation
-- adjustment and CBAM benchmarks (EU) 2025/2620).
--
-- Producer side (non-EU installation operators, e.g. UAE plants exporting to the EU):
--   cbam_installation   the installation as registered in the CBAM Registry (O3CI portal): operator and site details
--   cbam_process        its production processes, one per aggregated goods category and route
--   cbam_report         one reporting year of an installation: electricity factor, verification, carbon price paid
--   cbam_report_line    per process: activity level, attributed direct emissions, electricity, share from default values
--   cbam_precursor      precursors consumed by a process (their embedded emissions are added)
--   cbam_good           goods (CN codes) produced by a process in the year
--
-- Importer side (EU authorised CBAM declarants):
--   cbam_import         goods imported: CN code, origin, mass, installation, actual or default emissions, benchmark
--
-- cbam_reference       default values, CBAM benchmarks and certificate prices (shared rows have no company)
SELECT set_config('app.platform', 'on', true);

CREATE TABLE IF NOT EXISTS cbam_installation (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  facility_id   uuid REFERENCES org_node(id) ON DELETE SET NULL,
  name          text NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  registry_id   text,                       -- identifier given by the CBAM Registry (O3CI)
  unlocode      text,                       -- UN/LOCODE of the location, e.g. AE SHJ
  address       text, city text, postcode text,
  country       text NOT NULL DEFAULT 'AE',
  lat           numeric, lon numeric,       -- main emission source, six decimals
  operator_name text, operator_reg text, operator_address text, operator_country text,
  contact_name  text, contact_email text, contact_phone text,
  notes         text NOT NULL DEFAULT '',
  created_name  text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cbam_process (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  installation_id uuid NOT NULL REFERENCES cbam_installation(id) ON DELETE CASCADE,
  category        text NOT NULL,              -- aggregated goods category (lib/cbam.ts)
  route           text NOT NULL DEFAULT '',   -- production route where the category has several
  name            text NOT NULL CHECK (length(name) BETWEEN 2 AND 200)
);

CREATE TABLE IF NOT EXISTS cbam_report (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  installation_id uuid NOT NULL REFERENCES cbam_installation(id) ON DELETE CASCADE,
  year            int NOT NULL CHECK (year BETWEEN 2023 AND 2100),
  period_start    date NOT NULL, period_end date NOT NULL,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'verified', 'shared')),
  elec_ef         numeric CHECK (elec_ef >= 0),       -- tCO2 per MWh of electricity consumed
  elec_ef_source  text,
  monitoring_plan text,
  verifier_name   text, verifier_accreditation text, verifier_country text, verification_date date, site_visit_date date,
  opinion         text,                                -- verification opinion (reasonable assurance)
  carbon_price    jsonb,                               -- {instrument, country, eurPerT, currency, amount, rebate, evidence}
  notes           text NOT NULL DEFAULT '',
  shared_with     text NOT NULL DEFAULT '',            -- EORI numbers / importers the data is disclosed to
  updated_name    text, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (installation_id, year),
  CHECK (period_end >= period_start)
);

CREATE TABLE IF NOT EXISTS cbam_report_line (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  report_id     uuid NOT NULL REFERENCES cbam_report(id) ON DELETE CASCADE,
  process_id    uuid NOT NULL REFERENCES cbam_process(id) ON DELETE CASCADE,
  activity_t    numeric CHECK (activity_t >= 0),       -- activity level: tonnes produced (MWh for electricity)
  direct_t      numeric CHECK (direct_t >= 0),         -- attributed direct emissions, tCO2e
  elec_mwh      numeric CHECK (elec_mwh >= 0),         -- electricity consumed by the process
  default_share numeric NOT NULL DEFAULT 0 CHECK (default_share BETWEEN 0 AND 1),  -- share of the direct emissions determined with default values
  params        jsonb NOT NULL DEFAULT '{}',           -- qualifying parameters (clinker ratio, scrap share, N content…)
  UNIQUE (report_id, process_id)
);

CREATE TABLE IF NOT EXISTS cbam_precursor (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  line_id       uuid NOT NULL REFERENCES cbam_report_line(id) ON DELETE CASCADE,
  category      text NOT NULL,
  cn            text,
  origin        text,
  quantity_t    numeric NOT NULL CHECK (quantity_t >= 0),
  see_direct    numeric NOT NULL CHECK (see_direct >= 0),
  see_indirect  numeric NOT NULL DEFAULT 0 CHECK (see_indirect >= 0),
  source        text NOT NULL DEFAULT 'actual' CHECK (source IN ('actual', 'default')),
  supplier      text, installation_ref text, period text
);

CREATE TABLE IF NOT EXISTS cbam_good (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  line_id     uuid NOT NULL REFERENCES cbam_report_line(id) ON DELETE CASCADE,
  cn          text NOT NULL CHECK (cn ~ '^[0-9]{4,8}$'),
  description text NOT NULL DEFAULT '',
  quantity_t  numeric CHECK (quantity_t >= 0)
);

CREATE TABLE IF NOT EXISTS cbam_import (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  year            int NOT NULL CHECK (year BETWEEN 2026 AND 2100),
  import_date     date,
  quarter         int NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  cn              text NOT NULL CHECK (cn ~ '^[0-9]{4,8}$'),
  description     text NOT NULL DEFAULT '',
  origin          text NOT NULL,                     -- country of origin
  mass            numeric NOT NULL CHECK (mass > 0), -- tonnes (MWh for electricity)
  procedure       text,                              -- customs procedure (40, 42, inward processing…)
  customs_ref     text,
  supplier        text,
  installation    text, installation_id_reg text, route text,
  report_id       uuid REFERENCES cbam_report(id) ON DELETE SET NULL,  -- own installation's report (company is producer and importer)
  source          text NOT NULL DEFAULT 'default' CHECK (source IN ('actual', 'default')),
  see_direct      numeric CHECK (see_direct >= 0), see_indirect numeric CHECK (see_indirect >= 0),
  default_value   numeric CHECK (default_value >= 0),   -- tCO2e/t before the mark-up
  benchmark       numeric CHECK (benchmark >= 0),       -- CBAM benchmark tCO2e/t for the free allocation adjustment
  carbon_price_eur numeric CHECK (carbon_price_eur >= 0), -- carbon price effectively paid in the country of origin, EUR per tonne of good
  verifier_ref    text,
  notes           text NOT NULL DEFAULT '',
  created_name    text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cbam_import_t ON cbam_import (tenant_id, year);

CREATE TABLE IF NOT EXISTS cbam_reference (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid REFERENCES tenant(id) ON DELETE CASCADE,   -- NULL: shared
  kind       text NOT NULL CHECK (kind IN ('default', 'benchmark', 'price')),
  cn         text, country text, route text,
  year       int NOT NULL, quarter int CHECK (quarter BETWEEN 1 AND 4),
  value      numeric NOT NULL CHECK (value >= 0),
  source     text NOT NULL,
  indicative boolean NOT NULL DEFAULT false,
  created_name text, created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['cbam_installation', 'cbam_process', 'cbam_report', 'cbam_report_line', 'cbam_precursor', 'cbam_good', 'cbam_import'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;
ALTER TABLE cbam_reference ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbam_reference FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ref_read ON cbam_reference;
DROP POLICY IF EXISTS ref_write ON cbam_reference;
CREATE POLICY ref_read ON cbam_reference FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on');
CREATE POLICY ref_write ON cbam_reference FOR ALL
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on');

-- certificate prices for 2026 imports: quarterly average of EU ETS auction closing prices (Article 21(1a))
INSERT INTO cbam_reference (tenant_id, kind, year, quarter, value, source, indicative)
SELECT NULL, 'price', 2026, q, v, 'European Commission, CBAM certificate price for the quarter (check the published value)', false
  FROM (VALUES (1, 75.36), (2, 75.28), (3, 82.32)) x(q, v)
 WHERE NOT EXISTS (SELECT 1 FROM cbam_reference WHERE kind = 'price' AND tenant_id IS NULL AND year = 2026 AND quarter = x.q);

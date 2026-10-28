-- UAE MRV (a package of its own: tenant.products 'uaemrv'):
--   Abu Dhabi facility MRV (EAD Resolution No. 3 of 2026): Scope 1 per facility and calendar year, source streams,
--   tiers, monitoring plan, verification, mitigation measures;
--   federal reporting (Federal Decree-Law No. 11 of 2024, Cabinet Resolution No. 67 of 2024): Scope 1 and 2 on the
--   national MRV system (IEQT), the National Register for Carbon Credits above 0.5 MtCO2e.
--
--   mrv_facility      a reporting facility: emirate, sector, EAD identifiers, monitoring plan, verifier
--   mrv_year          the facility's reporting year: status, production, data gaps, QA, verification
--   mrv_stream        a source stream of the year (calculation, mass balance, measured, other gas) as JSON
--   mrv_measure       a mitigation measure (facility, or the whole company when facility_id is NULL)
--   mrv_company_year  the company's federal position for a year: designation, NRCC, IEQT submission, verifier
SELECT set_config('app.platform', 'on', true);

ALTER TABLE tenant DROP CONSTRAINT IF EXISTS tenant_products_check;
ALTER TABLE tenant ADD CONSTRAINT tenant_products_check CHECK (products <@ ARRAY['ekotrace', 'ekofin', 'cbam', 'ccts', 'brsr', 'uaemrv']::text[] AND cardinality(products) >= 1);

CREATE TABLE IF NOT EXISTS mrv_facility (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  node_id         uuid REFERENCES org_node(id) ON DELETE SET NULL,          -- the inventory facility it reads entries from
  name            text NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  emirate         text NOT NULL CHECK (emirate IN ('AZ', 'DU', 'SH', 'AJ', 'UQ', 'RK', 'FU')),
  sector          text NOT NULL CHECK (sector IN ('power', 'oil_gas', 'industry', 'transport', 'other')),
  sub_sector      text CHECK (sub_sector IS NULL OR length(sub_sector) <= 120),
  ead_id          text CHECK (ead_id IS NULL OR length(ead_id) <= 80),       -- EAD facility / registration ID
  permit_no       text CHECK (permit_no IS NULL OR length(permit_no) <= 80), -- environmental permit
  operator        text CHECK (operator IS NULL OR length(operator) <= 200),
  address         text CHECK (address IS NULL OR length(address) <= 400),
  operations_start date,
  registered_on   date,
  mp_version      text CHECK (mp_version IS NULL OR length(mp_version) <= 40),
  mp_submitted    date,
  mp_change       date,                                                     -- last significant change (plan revised within 30 days)
  verifier        text CHECK (verifier IS NULL OR length(verifier) <= 200),
  verifier_since  int CHECK (verifier_since IS NULL OR verifier_since BETWEEN 2000 AND 2100),
  notes           text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  created_name    text, updated_name text, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS mrv_year (
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  facility_id     uuid NOT NULL REFERENCES mrv_facility(id) ON DELETE CASCADE,
  year            int NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'submitted', 'verified')),
  submitted_on    date, reference text CHECK (reference IS NULL OR length(reference) <= 120),
  production      jsonb NOT NULL DEFAULT '[]',                              -- [{product, qty, unit}]
  gaps            jsonb NOT NULL DEFAULT '[]',                              -- [{description, approach, t}]
  qa              text NOT NULL DEFAULT '' CHECK (length(qa) <= 8000),      -- management & QA/QC
  verif_notified  date, site_visit date, verified_on date,
  opinion         text CHECK (opinion IS NULL OR opinion IN ('unmodified', 'modified', 'adverse')),
  statement_doc   uuid REFERENCES document(id) ON DELETE SET NULL,
  updated_name    text, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (facility_id, year)
);

CREATE TABLE IF NOT EXISTS mrv_stream (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  facility_id     uuid NOT NULL REFERENCES mrv_facility(id) ON DELETE CASCADE,
  year            int NOT NULL,
  sort            int NOT NULL DEFAULT 0,
  entry_key       text,                                                     -- 'item:<id>' / 'gas:<code>' when filled from entries
  data            jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS mrv_stream_fy ON mrv_stream (facility_id, year, sort);

CREATE TABLE IF NOT EXISTS mrv_measure (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  facility_id     uuid REFERENCES mrv_facility(id) ON DELETE CASCADE,       -- NULL = company-wide (federal reduction measures)
  title           text NOT NULL CHECK (length(title) BETWEEN 2 AND 300),
  means           text NOT NULL CHECK (means IN ('efficiency', 'clean_energy', 'sinks', 'ccus', 'fluorocarbons', 'offsetting', 'waste', 'fuel_switch', 'methane', 'other')),
  status          text NOT NULL CHECK (status IN ('implemented', 'planned', 'studied')),
  start_year      int CHECK (start_year IS NULL OR start_year BETWEEN 2000 AND 2100),
  t_per_year      numeric CHECK (t_per_year IS NULL OR t_per_year >= 0),
  capex_aed       numeric CHECK (capex_aed IS NULL OR capex_aed >= 0),
  note            text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  created_name    text, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mrv_company_year (
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  year            int NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  designated      text NOT NULL DEFAULT 'unknown' CHECK (designated IN ('yes', 'no', 'unknown')),
  designation_ref text CHECK (designation_ref IS NULL OR length(designation_ref) <= 200),
  nrcc_no         text CHECK (nrcc_no IS NULL OR length(nrcc_no) <= 80),
  nrcc_registered date,
  ieqt_status     text NOT NULL DEFAULT 'not_started' CHECK (ieqt_status IN ('not_started', 'registered', 'draft', 'submitted', 'verified')),
  ieqt_submitted  date, ieqt_ref text CHECK (ieqt_ref IS NULL OR length(ieqt_ref) <= 120),
  verifier        text CHECK (verifier IS NULL OR length(verifier) <= 200),
  s1_typed        numeric CHECK (s1_typed IS NULL OR s1_typed >= 0),        -- without the GHG inventory
  s2_typed        numeric CHECK (s2_typed IS NULL OR s2_typed >= 0),
  notes           text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  updated_name    text, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, year)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['mrv_facility', 'mrv_year', 'mrv_stream', 'mrv_measure', 'mrv_company_year'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

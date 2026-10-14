-- Base-year recalculation and restatement (RFP 3.2.9; GHG Protocol Corporate Standard ch. 5, ISO 14064-1 6.4.1).
-- A change to the company (acquisition, divestment, in- or outsourcing), its method (factors, GWP, calculation)
-- or an error found is recorded with its effect on the base year by scope. A second person approves it; when the
-- change, alone or with earlier recorded changes, reaches the significance threshold the base year is restated:
-- targets, the Net Zero path, KPIs and reports then use the restated base year. The original figures are kept.
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS restate_threshold numeric(5,2) NOT NULL DEFAULT 5 CHECK (restate_threshold BETWEEN 0 AND 50);

CREATE TABLE IF NOT EXISTS base_restatement (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  base_year     int NOT NULL,
  trigger       text NOT NULL CHECK (trigger IN ('acquisition', 'divestment', 'insourcing', 'outsourcing', 'method', 'factor', 'error', 'boundary', 'other')),
  title         text NOT NULL CHECK (length(title) BETWEEN 3 AND 200),
  description   text NOT NULL DEFAULT '',
  facility_id   uuid REFERENCES org_node(id) ON DELETE SET NULL,   -- the facility concerned (counted in views that include it); NULL: the whole company
  effective     date,                                              -- when the change happened
  s1_t          numeric NOT NULL DEFAULT 0,                        -- change to the base year, tCO2e (+ adds, − removes)
  s2_t          numeric NOT NULL DEFAULT 0,                        -- Scope 2 location-based
  s2m_t         numeric,                                           -- Scope 2 market-based (NULL: as location-based)
  s3_t          numeric NOT NULL DEFAULT 0,
  document_id   uuid REFERENCES document(id) ON DELETE SET NULL,   -- evidence (Document vault)
  force         boolean NOT NULL DEFAULT false,                    -- restate even below the threshold (company policy)
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  applied       boolean NOT NULL DEFAULT false,                    -- in the restated base year
  applied_at    timestamptz,
  applied_with  uuid,                                              -- the restatement whose approval took the cumulative change over the threshold
  base_before   numeric,                                           -- base-year total (tCO2e) when decided
  pct           numeric,                                           -- this change as % of it
  proposed_by   uuid REFERENCES app_user(id) ON DELETE SET NULL, proposed_name text, proposed_at timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid REFERENCES app_user(id) ON DELETE SET NULL, decided_name text, decided_at timestamptz, decision_note text
);
CREATE INDEX IF NOT EXISTS base_restatement_year ON base_restatement (tenant_id, base_year);
ALTER TABLE base_restatement ENABLE ROW LEVEL SECURITY;
ALTER TABLE base_restatement FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON base_restatement;
CREATE POLICY tenant_isolation ON base_restatement
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on');

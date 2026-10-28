-- SEBI BRSR Core (Business Responsibility and Sustainability Reporting): the nine attributes with their KPIs,
-- for a financial year (April–March), ready for reasonable assurance or assessment; and the BRSR Core of the
-- company's value chain (top upstream and downstream partners).
--
--   brsr_report   one per financial year: revenue from operations, PPP conversion factor, physical output,
--                 assurance or assessment provider and level, status (draft / ready / final)
--   brsr_value    a KPI's value for the year when typed (or an override of a value worked out from entries),
--                 its note, evidence (Document vault), owner and review status
--   brsr_partner  a value-chain partner: upstream (supplier) or downstream (customer), its share of purchases or
--                 sales, the share of its figures attributable to business with the company, its KPI values
SELECT set_config('app.platform', 'on', true);

CREATE TABLE IF NOT EXISTS brsr_report (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  fy              int NOT NULL CHECK (fy BETWEEN 2020 AND 2100),          -- 2025 = FY 2025-26 (April 2025 – March 2026)
  revenue_inr     numeric CHECK (revenue_inr IS NULL OR revenue_inr >= 0),  -- revenue from operations, ₹
  ppp_factor      numeric CHECK (ppp_factor IS NULL OR ppp_factor > 0),     -- ₹ per international $ (IMF)
  output_qty      numeric CHECK (output_qty IS NULL OR output_qty > 0),     -- physical output for intensity per unit of product
  output_unit     text CHECK (output_unit IS NULL OR length(output_unit) <= 40),
  facility_ids    uuid[],                                                   -- NULL = every facility of the company
  provider        text CHECK (provider IS NULL OR length(provider) <= 200),
  approach        text NOT NULL DEFAULT 'assurance' CHECK (approach IN ('assurance', 'assessment', 'none')),
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'final')),
  notes           text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  updated_name    text, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, fy)
);

CREATE TABLE IF NOT EXISTS brsr_value (
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  report_id     uuid NOT NULL REFERENCES brsr_report(id) ON DELETE CASCADE,
  kpi           text NOT NULL CHECK (kpi ~ '^[a-z0-9_.]{2,60}$'),
  value         numeric,                                    -- typed value, or an override of the worked-out value
  note          text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  document_id   uuid REFERENCES document(id) ON DELETE SET NULL,
  owner_name    text CHECK (owner_name IS NULL OR length(owner_name) <= 120),
  review        text NOT NULL DEFAULT 'open' CHECK (review IN ('open', 'ready', 'reviewed')),
  reviewed_name text, reviewed_at timestamptz,
  updated_name  text, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, kpi)
);

CREATE TABLE IF NOT EXISTS brsr_partner (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  report_id     uuid NOT NULL REFERENCES brsr_report(id) ON DELETE CASCADE,
  side          text NOT NULL CHECK (side IN ('upstream', 'downstream')),
  name          text NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  supplier_id   uuid REFERENCES supplier(id) ON DELETE SET NULL,
  amount_inr    numeric CHECK (amount_inr IS NULL OR amount_inr >= 0),   -- purchases from / sales to the partner in the year
  attributable  numeric CHECK (attributable IS NULL OR (attributable >= 0 AND attributable <= 1)),  -- share of the partner's figures from business with the company
  values        jsonb NOT NULL DEFAULT '{}',                -- KPI code → value (the partner's whole figure)
  note          text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  updated_name  text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS brsr_partner_r ON brsr_partner (report_id, side);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['brsr_report', 'brsr_value', 'brsr_partner'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

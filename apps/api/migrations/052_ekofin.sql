-- EKOFIN: financed emissions for banks, investors and other financial institutions (PCAF Part A).
-- Same platform as Ekotrace: a company has one or both products switched on (tenant.products).
--
--   fin_factor        sector emission factors (tCO2e per million of revenue or of assets), shared library
--                     managed by platform staff; several libraries (e.g. PCAF database, EXIOBASE, own) side by side
--   fin_portfolio     a loan book, fund or mandate; reporting currency, factor library, Scope 3 on or off
--   fin_period        a portfolio at a reporting date; locked periods keep their results and cannot change
--   fin_counterparty  a company lent to or invested in (one record per company, shared by all portfolios)
--   fin_financials    its EVIC, equity, debt, revenue, total assets for a financial year
--   fin_emission      its reported or activity-based emissions for a year, with the PCAF score (1–3)
--   fin_holding       an exposure: counterparty, asset class, outstanding amount at the reporting date
SELECT set_config('app.platform', 'on', true);

ALTER TABLE tenant ADD COLUMN IF NOT EXISTS products text[] NOT NULL DEFAULT '{ekotrace}';
ALTER TABLE tenant DROP CONSTRAINT IF EXISTS tenant_products_check;
ALTER TABLE tenant ADD CONSTRAINT tenant_products_check CHECK (products <@ ARRAY['ekotrace', 'ekofin']::text[] AND cardinality(products) >= 1);

CREATE TABLE IF NOT EXISTS fin_factor (
  id              bigserial PRIMARY KEY,
  library         text NOT NULL CHECK (length(library) BETWEEN 2 AND 80),   -- e.g. "PCAF database 2025", "EXIOBASE 3.9"
  sector_standard text NOT NULL DEFAULT 'NACE' CHECK (sector_standard IN ('NACE', 'GICS', 'ISIC', 'NAICS', 'OTHER')),
  sector_code     text NOT NULL,                       -- e.g. C24 (NACE division); a longer code inherits from its prefix
  sector_name     text,
  region          text NOT NULL DEFAULT 'GLOBAL',      -- ISO country code, or GLOBAL
  year            int NOT NULL CHECK (year BETWEEN 1990 AND 2100),
  basis           text NOT NULL CHECK (basis IN ('revenue', 'assets')),
  currency        text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  s1              numeric NOT NULL CHECK (s1 >= 0),    -- tCO2e per million of the currency
  s2              numeric NOT NULL CHECK (s2 >= 0),
  s3              numeric CHECK (s3 >= 0),
  source          text NOT NULL,
  note            text,
  created_name    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (library, sector_standard, sector_code, region, year, basis)
);
CREATE INDEX IF NOT EXISTS fin_factor_lookup ON fin_factor (library, sector_standard, basis, sector_code);

CREATE TABLE IF NOT EXISTS fin_portfolio (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(name) BETWEEN 2 AND 160),
  kind            text NOT NULL DEFAULT 'loan_book' CHECK (kind IN ('loan_book', 'fund', 'mandate', 'other')),
  currency        text NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),   -- reporting currency
  factor_library  text,                                -- which fin_factor library estimates use
  include_scope3  boolean NOT NULL DEFAULT false,
  description     text NOT NULL DEFAULT '',
  archived        boolean NOT NULL DEFAULT false,
  created_by      uuid REFERENCES app_user(id) ON DELETE SET NULL, created_name text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS fin_period (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  portfolio_id    uuid NOT NULL REFERENCES fin_portfolio(id) ON DELETE CASCADE,
  as_of           date NOT NULL,                       -- reporting date of the outstanding amounts
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'locked')),
  note            text NOT NULL DEFAULT '',
  result          jsonb,                               -- figures kept when locked
  locked_by       uuid REFERENCES app_user(id) ON DELETE SET NULL, locked_name text, locked_at timestamptz,
  created_name    text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (portfolio_id, as_of)
);

CREATE TABLE IF NOT EXISTS fin_counterparty (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  norm            text NOT NULL,                       -- name for matching (lower case, no punctuation or legal form)
  country         text CHECK (country ~ '^[A-Z]{2}$'),
  lei             text CHECK (lei ~ '^[A-Z0-9]{20}$'),
  isin            text CHECK (isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'),
  local_id        text,                                -- company registration number, internal customer ID
  listed          boolean NOT NULL DEFAULT false,
  sector_standard text NOT NULL DEFAULT 'NACE' CHECK (sector_standard IN ('NACE', 'GICS', 'ISIC', 'NAICS', 'OTHER')),
  sector_code     text,
  sector_name     text,
  contact_email   text,
  note            text NOT NULL DEFAULT '',
  created_name    text, created_at timestamptz NOT NULL DEFAULT now(), updated_name text, updated_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS fin_counterparty_lei ON fin_counterparty (tenant_id, lei) WHERE lei IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fin_counterparty_isin ON fin_counterparty (tenant_id, isin) WHERE isin IS NOT NULL;
CREATE INDEX IF NOT EXISTS fin_counterparty_norm ON fin_counterparty (tenant_id, norm);

CREATE TABLE IF NOT EXISTS fin_financials (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  counterparty_id uuid NOT NULL REFERENCES fin_counterparty(id) ON DELETE CASCADE,
  year            int NOT NULL CHECK (year BETWEEN 1990 AND 2100),   -- financial year
  currency        text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  evic            numeric CHECK (evic >= 0),           -- enterprise value including cash (listed companies)
  equity          numeric,                             -- total equity (book value)
  debt            numeric CHECK (debt >= 0),           -- total debt
  revenue         numeric CHECK (revenue >= 0),
  total_assets    numeric CHECK (total_assets >= 0),
  source          text NOT NULL DEFAULT '',
  updated_name    text, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (counterparty_id, year)
);

CREATE TABLE IF NOT EXISTS fin_emission (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  counterparty_id uuid NOT NULL REFERENCES fin_counterparty(id) ON DELETE CASCADE,
  year            int NOT NULL CHECK (year BETWEEN 1990 AND 2100),
  score           int NOT NULL CHECK (score BETWEEN 1 AND 3),   -- 1 verified, 2 unverified reported, 3 physical activity based
  s1              numeric NOT NULL CHECK (s1 >= 0),    -- tCO2e
  s2              numeric NOT NULL CHECK (s2 >= 0),
  s3              numeric CHECK (s3 >= 0),
  source          text NOT NULL,                       -- e.g. "Sustainability report 2025, p. 41", "CDP 2025"
  document_id     uuid REFERENCES document(id) ON DELETE SET NULL,
  note            text NOT NULL DEFAULT '',
  created_by      uuid REFERENCES app_user(id) ON DELETE SET NULL, created_name text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (counterparty_id, year, score)
);

CREATE TABLE IF NOT EXISTS fin_holding (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  period_id       uuid NOT NULL REFERENCES fin_period(id) ON DELETE CASCADE,
  counterparty_id uuid NOT NULL REFERENCES fin_counterparty(id) ON DELETE RESTRICT,
  asset_class     text NOT NULL CHECK (asset_class IN ('listed_equity', 'corporate_bond', 'business_loan', 'unlisted_equity')),
  outstanding     numeric NOT NULL CHECK (outstanding >= 0),
  currency        text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  internal_ref    text,                                -- loan or position number in the bank's system
  origination     date,
  force_score     int CHECK (force_score BETWEEN 1 AND 5),
  force_reason    text,
  note            text NOT NULL DEFAULT '',
  created_name    text, created_at timestamptz NOT NULL DEFAULT now(), updated_name text, updated_at timestamptz,
  CHECK (force_score IS NULL OR length(coalesce(force_reason, '')) >= 3)
);
CREATE INDEX IF NOT EXISTS fin_holding_period ON fin_holding (period_id);
CREATE INDEX IF NOT EXISTS fin_holding_cp ON fin_holding (counterparty_id);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['fin_portfolio', 'fin_period', 'fin_counterparty', 'fin_financials', 'fin_emission', 'fin_holding'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

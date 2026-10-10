-- Purchased goods & services (Scope 3.1) and the other spend-based Scope 3 categories.
--
--   Lines arrive by upload (any CSV / Excel layout), manually, or from an ERP through the API.
--   They are grouped by description, mapped to a spend category (remembered rules, text matching,
--   optionally an approved AI service), checked for overlap with other categories, calculated
--   (supplier-specific factor, else spend-based: currency → USD at the month's rate → factor's
--   price year with the US CPI × kg CO2e per USD) and published as entries per facility × month.

-- Seeding shared rows below runs as the platform (row-level security is forced).
SELECT set_config('app.platform', 'on', true);

-- -------------------------------------------------------------- money units --
-- One dimension per currency: amounts are converted between currencies with dated exchange
-- rates (fx_rate), never with a fixed unit factor.
INSERT INTO unit (code, name, dimension, to_base, is_base, sort) VALUES
  ('USD', 'US dollar', 'money_USD', 1, true, 300),
  ('AED', 'UAE dirham', 'money_AED', 1, true, 301),
  ('EUR', 'Euro', 'money_EUR', 1, true, 302),
  ('GBP', 'Pound sterling', 'money_GBP', 1, true, 303),
  ('SAR', 'Saudi riyal', 'money_SAR', 1, true, 304),
  ('INR', 'Indian rupee', 'money_INR', 1, true, 305)
ON CONFLICT (code) DO NOTHING;
-- Pieces / units bought (supplier factors per item).
INSERT INTO unit (code, name, dimension, to_base, is_base, aliases, sort) VALUES ('pcs', 'piece', 'count', 1, true, '{pc,piece,pieces,unit,units,ea,each,nos,no}', 290)
ON CONFLICT (code) DO NOTHING;

-- --------------------------------------------------------------- catalogue --
ALTER TABLE category DROP CONSTRAINT IF EXISTS category_calc_method_check;
ALTER TABLE category ADD CONSTRAINT category_calc_method_check
  CHECK (calc_method IN ('combustion','fugitive','vehicle','electricity','waste','waste_disposal','spend'));

INSERT INTO category (scope, code, name, calc_method, description, sort, ghg_category) VALUES
  (3, 'purchased_goods', 'Purchased goods & services (Scope 3.1)', 'spend',
   'Everything the company buys that is not capital goods, fuel or energy: from purchase lines (upload, manual or ERP), with the supplier''s own factor where available, else spend-based factors.', 60, 1),
  (3, 'capital_goods', 'Capital goods (Scope 3.2)', 'spend',
   'Purchases capitalised as assets (machinery, vehicles, buildings, IT equipment): spend-based for now.', 61, 2),
  (3, 'upstream_transport', 'Upstream transport (Scope 3.4)', 'spend',
   'Freight, couriers and warehousing paid by the company: spend-based for now (distance-based later).', 63, 4),
  (3, 'business_travel', 'Business travel (Scope 3.6)', 'spend',
   'Flights, hotels, taxis and other travel paid by the company: spend-based for now (distance-based later).', 65, 6),
  (3, 'upstream_leased', 'Upstream leased assets (Scope 3.8)', 'spend',
   'Rent of buildings and equipment not already in Scope 1 and 2: spend-based for now.', 67, 8)
ON CONFLICT (code) DO NOTHING;

-- Spend categories: subcategory = NAICS sector; items (NAICS commodities) are loaded by the importer
-- (EPA Supply Chain GHG Emission Factors v1.3, or the old Ekotrace category list).
INSERT INTO subcategory (category_id, code, name, units, default_unit, sort)
SELECT c.id, v.code, v.name, '{USD}'::text[], 'USD', v.sort
FROM category c, (VALUES
  ('naics_11', 'Agriculture, forestry & fishing', 11), ('naics_21', 'Mining, quarrying, oil & gas', 21),
  ('naics_22', 'Utilities', 22), ('naics_23', 'Construction', 23), ('naics_31', 'Manufacturing', 31),
  ('naics_42', 'Wholesale trade', 42), ('naics_44', 'Retail trade', 44), ('naics_48', 'Transport & warehousing', 48),
  ('naics_51', 'Information & telecoms', 51), ('naics_52', 'Finance & insurance', 52), ('naics_53', 'Real estate, rental & leasing', 53),
  ('naics_54', 'Professional, scientific & technical services', 54), ('naics_55', 'Management of companies', 55),
  ('naics_56', 'Administrative, support & waste services', 56), ('naics_61', 'Education', 61), ('naics_62', 'Health care & social assistance', 62),
  ('naics_71', 'Arts, entertainment & recreation', 71), ('naics_72', 'Accommodation & food services', 72),
  ('naics_81', 'Other services', 81), ('naics_92', 'Public administration', 92), ('other', 'Other (company list)', 99)
) AS v(code, name, sort)
WHERE c.code = 'purchased_goods'
ON CONFLICT (category_id, code) DO NOTHING;

-- Lines with a supplier's own factor but no spend category.
INSERT INTO item (subcategory_id, code, name, default_unit, note, sort)
SELECT s.id, 'purchase:supplier-specific', 'Purchases with a supplier-specific factor', 'USD', 'Lines calculated with the supplier''s own factor and not mapped to a spend category.', 999
FROM subcategory s JOIN category c ON c.id = s.category_id WHERE c.code = 'purchased_goods' AND s.code = 'other'
ON CONFLICT (code) DO NOTHING;

-- Spend factors: kg CO2e per unit of a currency of a given year (EPA v1.3: per 2022 USD, purchaser price).
ALTER TABLE factor ADD COLUMN IF NOT EXISTS price_year int;

-- ---------------------------------------------------- exchange rates & CPI --
-- tenant_id NULL = platform list (shared); a company can add its own (e.g. treasury rates).
-- kind: month (average of the month; period = 1st of the month), year (annual average;
-- period = 1 January), fixed (company budget rate for a year), peg (fixed peg; period = start).
CREATE TABLE IF NOT EXISTS fx_rate (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid REFERENCES tenant(id) ON DELETE CASCADE,
  currency    text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  kind        text NOT NULL CHECK (kind IN ('month','year','fixed','peg')),
  period      date NOT NULL,
  per_usd     numeric(24,10) NOT NULL CHECK (per_usd > 0),   -- units of the currency for 1 USD
  source      text NOT NULL,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS fx_rate_one ON fx_rate (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), currency, kind, period);
ALTER TABLE fx_rate ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_rate FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fx_read ON fx_rate;
DROP POLICY IF EXISTS fx_write ON fx_rate;
CREATE POLICY fx_read ON fx_rate FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on');
CREATE POLICY fx_write ON fx_rate FOR ALL
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on');

-- Currencies pegged to the US dollar (central bank pegs).
INSERT INTO fx_rate (tenant_id, currency, kind, period, per_usd, source) VALUES
  (NULL, 'USD', 'peg', '1900-01-01', 1, 'US dollar'),
  (NULL, 'AED', 'peg', '1997-11-01', 3.6725, 'Central Bank of the UAE: fixed peg since 1997'),
  (NULL, 'SAR', 'peg', '1986-06-01', 3.75, 'Saudi Central Bank: fixed peg since 1986'),
  (NULL, 'QAR', 'peg', '2001-07-01', 3.64, 'Qatar Central Bank: fixed peg since 2001'),
  (NULL, 'OMR', 'peg', '1986-01-01', 0.3845, 'Central Bank of Oman: fixed peg since 1986'),
  (NULL, 'BHD', 'peg', '2001-01-01', 0.376, 'Central Bank of Bahrain: fixed peg')
ON CONFLICT DO NOTHING;

-- Price indices to bring spend to the price year of a factor (US: CPI-U, all items, annual average).
CREATE TABLE IF NOT EXISTS price_index (
  region      text NOT NULL,                 -- 'US' (CPI-U)
  year        int NOT NULL,
  value       numeric(14,4) NOT NULL CHECK (value > 0),
  source      text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (region, year)
);
INSERT INTO price_index (region, year, value, source) VALUES
  ('US', 2019, 255.657, 'US BLS CPI-U, U.S. city average, all items, annual average (1982-84=100)'),
  ('US', 2020, 258.811, 'US BLS CPI-U, U.S. city average, all items, annual average (1982-84=100)'),
  ('US', 2021, 270.970, 'US BLS CPI-U, U.S. city average, all items, annual average (1982-84=100)'),
  ('US', 2022, 292.655, 'US BLS CPI-U, U.S. city average, all items, annual average (1982-84=100)'),
  ('US', 2023, 304.702, 'US BLS CPI-U, U.S. city average, all items, annual average (1982-84=100)'),
  ('US', 2024, 313.689, 'US BLS CPI-U, U.S. city average, all items, annual average (1982-84=100)')
ON CONFLICT DO NOTHING;

-- How the company converts currencies: month (default), year (annual average) or fixed (budget rate).
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS fx_method text NOT NULL DEFAULT 'month' CHECK (fx_method IN ('month','year','fixed'));
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'AED' CHECK (currency ~ '^[A-Z]{3}$');
-- Mapping with an AI service: only when the company has approved the service (and it is configured).
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS ai_mapping boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------- suppliers --
CREATE TABLE IF NOT EXISTS supplier (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name          text NOT NULL,
  norm          text NOT NULL,                 -- normalised name, for matching
  aliases       text[] NOT NULL DEFAULT '{}',  -- other spellings (normalised) that mean this supplier
  country       text,
  reference     text,                          -- vendor number in the ERP
  contact_email text,
  note          text,
  origin        text NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','upload','api')),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, norm)
);
CREATE INDEX IF NOT EXISTS supplier_aliases ON supplier USING gin (aliases);

-- A supplier's own emission factor: per currency unit or per physical unit, for everything
-- bought from it (item_id NULL) or for one spend category.
CREATE TABLE IF NOT EXISTS supplier_ef (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES supplier(id) ON DELETE CASCADE,
  item_id     int REFERENCES item(id),
  co2e        numeric(30,12) NOT NULL CHECK (co2e >= 0),   -- kg CO2e per unit
  unit        text NOT NULL REFERENCES unit(code),          -- a currency (AED, USD…) or kg, t, L, kWh, unit…
  price_year  int,                                          -- for a per-currency factor: year of the money (else the purchase year)
  valid_from  date NOT NULL DEFAULT '2000-01-01',
  valid_to    date NOT NULL DEFAULT '2100-12-31',
  source      text NOT NULL,                                -- EPD, product carbon footprint, supplier's report…
  boundary    text,                                         -- cradle-to-gate…
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to >= valid_from)
);
CREATE INDEX IF NOT EXISTS supplier_ef_supplier ON supplier_ef(supplier_id);

-- ----------------------------------------------------------- import layouts --
-- A file layout seen before (same headers): which column is which, remembered per company.
CREATE TABLE IF NOT EXISTS purchase_profile (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name        text NOT NULL,
  signature   text NOT NULL,                  -- hash of the normalised headers
  settings    jsonb NOT NULL,                 -- { headerRow, columns: {field: header}, dateFormat, currency, facilityId, period }
  used_at     timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, signature)
);

-- ------------------------------------------------------------------ batches --
CREATE TABLE IF NOT EXISTS purchase_batch (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  source        text NOT NULL CHECK (source IN ('upload','manual','api')),
  name          text NOT NULL,
  document_id   uuid REFERENCES document(id),
  external_ref  text,                         -- API: the sender's batch reference
  settings      jsonb NOT NULL DEFAULT '{}',  -- columns, date format, defaults
  status        text NOT NULL DEFAULT 'setup' CHECK (status IN ('setup','receiving','queued','reading','mapping','review','publishing','published','failed')),
  progress      jsonb NOT NULL DEFAULT '{}',  -- { stage, done, total }
  error         text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  published_by  text
);
CREATE INDEX IF NOT EXISTS purchase_batch_tenant ON purchase_batch(tenant_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS purchase_batch_ref ON purchase_batch(tenant_id, external_ref) WHERE external_ref IS NOT NULL;

-- Lines with the same normalised description (and category text) form a group: mapped once.
CREATE TABLE IF NOT EXISTS purchase_group (
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  batch_id      uuid NOT NULL REFERENCES purchase_batch(id) ON DELETE CASCADE,
  key           text NOT NULL,
  description   text NOT NULL,                 -- a sample of the original text
  category_text text,
  gl_account    text,
  supplier      text,                          -- most frequent supplier name
  lines         int NOT NULL DEFAULT 0,
  usd           numeric(24,4) NOT NULL DEFAULT 0, -- spend in USD (purchase-month rates), for sorting
  item_id       int REFERENCES item(id),
  map_method    text CHECK (map_method IN ('rule','text','ai','manual','code')),
  confidence    numeric(5,4),
  candidates    jsonb NOT NULL DEFAULT '[]',   -- [{ itemId, score }]
  overlap       text,                          -- other category this looks like (business_travel, fuel…)
  overlap_why   text,
  decision      text CHECK (decision IN ('keep','move','exclude')),
  target        text,                          -- category code when moved (business_travel…)
  capital       boolean NOT NULL DEFAULT false, -- capital goods (Scope 3.2)
  updated_by    text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, key)
);
CREATE INDEX IF NOT EXISTS purchase_group_item ON purchase_group(batch_id, item_id);

CREATE TABLE IF NOT EXISTS purchase_line (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  batch_id      uuid NOT NULL REFERENCES purchase_batch(id) ON DELETE CASCADE,
  row_no        int NOT NULL,
  group_key     text NOT NULL,
  facility_id   uuid REFERENCES org_node(id),
  facility_text text,                          -- as written in the file (when not matched)
  period_start  date,
  period_end    date,
  purchase_date date,
  description   text NOT NULL,
  category_text text,
  gl_account    text,
  po_ref        text,
  supplier_text text,
  supplier_norm text,
  supplier_id   uuid REFERENCES supplier(id),
  amount        numeric(24,4),                 -- in currency; negative = credit note
  currency      text,
  quantity      numeric(24,6),
  unit          text,
  supplier_ef   numeric(30,12),                -- a factor written on the line itself
  supplier_ef_unit text,
  capital       boolean,
  problems      text[] NOT NULL DEFAULT '{}',
  dup_of        bigint,                        -- same line seen in an earlier batch
  -- result
  method        text CHECK (method IN ('supplier','spend')),
  item_id       int REFERENCES item(id),
  factor_id     bigint REFERENCES factor(id),
  supplier_ef_id uuid REFERENCES supplier_ef(id),
  fx_per_usd    numeric(24,10),
  fx_kind       text,
  cpi_ratio     numeric(14,8),
  usd           numeric(24,6),                 -- spend in USD at the purchase-month rate (for sorting, totals)
  base_amount   numeric(24,6),                 -- in the factor's unit (e.g. 2022 USD)
  base_unit     text,
  co2e          numeric(24,6),                 -- kg CO2e
  warnings      text[] NOT NULL DEFAULT '{}',
  calc_error    text,                          -- why the line cannot be calculated (no exchange rate…)
  status        text NOT NULL DEFAULT 'new' CHECK (status IN ('new','problem','unmapped','flagged','excluded','ready','published')),
  activity_id   uuid REFERENCES activity(id) ON DELETE SET NULL,
  fingerprint   text,                          -- date|amount|currency|supplier|description, for duplicates
  UNIQUE (batch_id, row_no)
);
CREATE INDEX IF NOT EXISTS purchase_line_group ON purchase_line(batch_id, group_key);
CREATE INDEX IF NOT EXISTS purchase_line_status ON purchase_line(batch_id, status);
CREATE INDEX IF NOT EXISTS purchase_line_fp ON purchase_line(tenant_id, fingerprint);
CREATE INDEX IF NOT EXISTS purchase_line_supplier ON purchase_line(supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS purchase_line_activity ON purchase_line(activity_id) WHERE activity_id IS NOT NULL;

-- Remembered mappings: a description, GL account, supplier or category text → spend category
-- (and/or a decision for overlapping lines). Learnt when someone maps a group with "remember".
CREATE TABLE IF NOT EXISTS purchase_rule (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  field       text NOT NULL CHECK (field IN ('text','gl','supplier','category')),
  pattern     text NOT NULL,                  -- normalised value
  item_id     int REFERENCES item(id),
  decision    text CHECK (decision IN ('keep','move','exclude')),
  target      text,
  capital     boolean,
  hits        int NOT NULL DEFAULT 0,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, field, pattern)
);

ALTER TABLE activity ADD COLUMN IF NOT EXISTS purchase_batch_id uuid REFERENCES purchase_batch(id);
CREATE INDEX IF NOT EXISTS activity_purchase_batch ON activity(purchase_batch_id) WHERE purchase_batch_id IS NOT NULL;

-- --------------------------------------------------------------------- jobs --
-- Background work (reading a large file, mapping, publishing), picked up by the worker.
CREATE TABLE IF NOT EXISTS job (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  ref         uuid,
  args        jsonb NOT NULL DEFAULT '{}',
  progress    jsonb NOT NULL DEFAULT '{}',   -- { stage, done, total }, written while it runs
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  attempts    int NOT NULL DEFAULT 0,
  error       text,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  started_at  timestamptz,
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS job_queued ON job(created_at) WHERE status = 'queued';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['supplier','supplier_ef','purchase_profile','purchase_batch','purchase_group','purchase_line','purchase_rule','job'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

-- Extended Producer Responsibility (a package of its own: tenant.products 'epr').
--   epr_stream  one obligation line: regime (India plastic / e-waste / batteries / tyres, EU PPWR in a member state, other),
--               role (producer, importer, brand owner, recycler), category, registration, settings for the calculation
--   epr_year    per stream and year: quantity placed on the market (recyclers: processed), pre-consumer waste, supplied to
--               other registered producers, recycled content, the obligation as the portal shows it, the annual return
--   epr_cert    certificates: bought (producers) or generated and sold (recyclers), the year they count for, validity
SELECT set_config('app.platform', 'on', true);

ALTER TABLE tenant DROP CONSTRAINT IF EXISTS tenant_products_check;
ALTER TABLE tenant ADD CONSTRAINT tenant_products_check CHECK (products <@ ARRAY['ekotrace', 'ekofin', 'cbam', 'ccts', 'brsr', 'uaemrv', 'energy', 'compliance', 'epr']::text[] AND cardinality(products) >= 1);

CREATE TABLE IF NOT EXISTS epr_stream (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  regime        text NOT NULL CHECK (regime IN ('in_plastic', 'in_ewaste', 'in_battery', 'in_tyre', 'eu_ppwr', 'other')),
  role          text NOT NULL CHECK (role IN ('producer', 'importer', 'brand_owner', 'recycler')),
  category      text NOT NULL CHECK (category ~ '^[a-z0-9_]{2,40}$'),
  name          text NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  country       text CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),         -- EU member state, or the scheme's country
  scheme        text NOT NULL DEFAULT '' CHECK (length(scheme) <= 200),          -- other schemes: the scheme's name
  registration  text CHECK (registration IS NULL OR length(registration) <= 120),
  avg_life      numeric CHECK (avg_life IS NULL OR avg_life BETWEEN 0 AND 50),   -- years (e-waste, batteries)
  food_contact  boolean NOT NULL DEFAULT false,
  target_pct    jsonb NOT NULL DEFAULT '{}',     -- year → obligation % typed
  recycling_pct jsonb NOT NULL DEFAULT '{}',     -- year → recycling share typed
  rc_pct        jsonb NOT NULL DEFAULT '{}',     -- year → recycled content % typed
  ec_rate       numeric CHECK (ec_rate IS NULL OR ec_rate >= 0),       -- environmental compensation per tonne
  cert_price    numeric CHECK (cert_price IS NULL OR cert_price >= 0), -- assumed certificate price per tonne
  fee_rate      numeric CHECK (fee_rate IS NULL OR fee_rate >= 0),     -- EU: PRO fee per tonne
  currency      text NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),
  pro           text CHECK (pro IS NULL OR length(pro) <= 200),        -- producer responsibility organisation / agency
  registered_on date,
  notes         text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS epr_stream_tenant ON epr_stream (tenant_id);

CREATE TABLE IF NOT EXISTS epr_year (
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  stream_id     uuid NOT NULL REFERENCES epr_stream(id) ON DELETE CASCADE,
  year          int NOT NULL CHECK (year BETWEEN 2015 AND 2100),
  placed        numeric CHECK (placed IS NULL OR placed >= 0),
  pre_consumer  numeric CHECK (pre_consumer IS NULL OR pre_consumer >= 0),
  supplied      numeric CHECK (supplied IS NULL OR supplied >= 0),
  recycled      numeric CHECK (recycled IS NULL OR recycled >= 0),
  obligation    numeric CHECK (obligation IS NULL OR obligation >= 0),
  return_status text NOT NULL DEFAULT 'not_started' CHECK (return_status IN ('not_started', 'in_progress', 'filed')),
  filed_on      date,
  return_ref    text CHECK (return_ref IS NULL OR length(return_ref) <= 120),
  document_id   uuid REFERENCES document(id) ON DELETE SET NULL,
  note          text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  updated_name  text, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stream_id, year),
  CHECK (return_status <> 'filed' OR filed_on IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS epr_cert (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  stream_id     uuid NOT NULL REFERENCES epr_stream(id) ON DELETE CASCADE,
  direction     text NOT NULL CHECK (direction IN ('in', 'out')),           -- in: bought or generated; out: sold
  kind          text NOT NULL CHECK (kind IN ('recycling', 'eol', 'recycled_content', 'refurbish', 'reuse')),
  year          int CHECK (year IS NULL OR year BETWEEN 2015 AND 2100),      -- compliance year it counts for (sold: the year sold)
  generated_year int CHECK (generated_year IS NULL OR generated_year BETWEEN 2015 AND 2100),
  tonnes        numeric NOT NULL CHECK (tonnes > 0),
  price         numeric CHECK (price IS NULL OR price >= 0),                  -- per tonne
  certificate_no text CHECK (certificate_no IS NULL OR length(certificate_no) <= 120),
  counterparty  text CHECK (counterparty IS NULL OR length(counterparty) <= 200),
  counterparty_reg text CHECK (counterparty_reg IS NULL OR length(counterparty_reg) <= 120),
  end_product   text CHECK (end_product IS NULL OR length(end_product) <= 80),
  traded_on     date,
  document_id   uuid REFERENCES document(id) ON DELETE SET NULL,
  note          text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  created_name  text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS epr_cert_stream ON epr_cert (stream_id, year);
CREATE UNIQUE INDEX IF NOT EXISTS epr_cert_number ON epr_cert (tenant_id, stream_id, direction, certificate_no) WHERE certificate_no IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['epr_stream', 'epr_year', 'epr_cert'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on') WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

-- Product LCA (product carbon footprints: ISO 14067, GHG Protocol Product Standard, ISO 14040/44).
--
--   lci_factor       life-cycle inventory factors (kg CO2e per unit). Rows with no company are the shared,
--                    indicative library; a company adds its own (licensed ecoinvent / EF 3.1, EPDs, measured).
--   lca_product      a product model: goal & scope (declared unit, functional unit, boundary, allocation, cut-off),
--                    the supplier it comes from (or none: the company's own product) and the spend category it is
--                    bought under; status draft → review → verified → published, with a version number.
--   lca_input        the inventory: one line per material, packaging, energy, transport leg, use or end-of-life input
--   lca_scenario     what-if changes to inputs (other material, amount or factor)
--   lca_publication  each published version (factor, stage split and inputs as they were)
--
-- Publishing a supplier's product writes its factor into supplier_ef, so purchases of that product are calculated
-- with it (cradle-to-gate, per declared unit).
SELECT set_config('app.platform', 'on', true);

CREATE TABLE IF NOT EXISTS lci_factor (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES tenant(id) ON DELETE CASCADE,          -- NULL: the shared library
  code        text NOT NULL,
  name        text NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  unit        text NOT NULL CHECK (length(unit) BETWEEN 1 AND 20),   -- kg, kWh, litre, t-km, m³, unit…
  co2e        numeric NOT NULL CHECK (co2e >= 0 AND co2e <= 1e9),   -- kg CO2e per unit
  stage       text NOT NULL CHECK (stage IN ('raw', 'packaging', 'manufacturing', 'transport', 'use', 'eol')),
  source      text NOT NULL,
  indicative  boolean NOT NULL DEFAULT false,
  active      boolean NOT NULL DEFAULT true,
  created_name text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lci_factor_code ON lci_factor (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), code);

CREATE TABLE IF NOT EXISTS lca_product (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  description   text NOT NULL DEFAULT '',
  supplier_id   uuid REFERENCES supplier(id) ON DELETE SET NULL,      -- NULL: the company's own product
  item_id       int REFERENCES item(id),                               -- spend category it is bought under
  declared_unit text NOT NULL DEFAULT 't',                             -- the unit the footprint is per (kg, t, pcs, L, m3, kWh)
  fu            text NOT NULL DEFAULT '1 tonne at factory gate',
  boundary      text NOT NULL DEFAULT 'cradle_to_gate' CHECK (boundary IN ('cradle_to_gate', 'cradle_to_grave', 'gate_to_gate')),
  standard      text NOT NULL DEFAULT 'ISO 14067 / GHG Protocol Product Standard',
  allocation    text NOT NULL DEFAULT 'Mass allocation',
  cutoff        text NOT NULL DEFAULT '1% of mass',
  ref_year      int NOT NULL CHECK (ref_year BETWEEN 1990 AND 2100),
  notes         text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'verified', 'published')),
  version       int NOT NULL DEFAULT 0,                                -- last published version
  created_by    uuid REFERENCES app_user(id) ON DELETE SET NULL, created_name text, created_at timestamptz NOT NULL DEFAULT now(),
  last_edit_by  uuid REFERENCES app_user(id) ON DELETE SET NULL, last_edit_name text, updated_at timestamptz NOT NULL DEFAULT now(),
  sent_by       uuid REFERENCES app_user(id) ON DELETE SET NULL, sent_name text, sent_at timestamptz,
  verified_by   uuid REFERENCES app_user(id) ON DELETE SET NULL, verified_name text, verified_at timestamptz, review_note text,
  published_factor numeric, published_at timestamptz, published_name text,
  supplier_ef_id uuid REFERENCES supplier_ef(id) ON DELETE SET NULL,
  changed_since_publish boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS lca_product_t ON lca_product (tenant_id, name);

CREATE TABLE IF NOT EXISTS lca_input (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES lca_product(id) ON DELETE CASCADE,
  position    int NOT NULL DEFAULT 0,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  stage       text NOT NULL CHECK (stage IN ('raw', 'packaging', 'manufacturing', 'transport', 'use', 'eol')),
  qty         numeric NOT NULL CHECK (qty >= 0 AND qty <= 1e12),
  unit        text NOT NULL CHECK (length(unit) BETWEEN 1 AND 20),
  co2e_per_unit numeric NOT NULL CHECK (co2e_per_unit >= 0 AND co2e_per_unit <= 1e9),   -- kg CO2e per unit; avoided emissions are not part of a footprint (ISO 14067)
  lci_id      uuid REFERENCES lci_factor(id) ON DELETE SET NULL,
  dq          text NOT NULL DEFAULT 'estimated' CHECK (dq IN ('verified', 'measured', 'supplier', 'estimated')),
  source      text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS lca_input_p ON lca_input (product_id, position);

CREATE TABLE IF NOT EXISTS lca_scenario (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES lca_product(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  changes     jsonb NOT NULL DEFAULT '[]',                              -- [{inputId, lciId?, qty?, co2e?}]
  created_name text, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lca_publication (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES lca_product(id) ON DELETE CASCADE,
  version     int NOT NULL,
  factor      numeric NOT NULL,                                         -- kg CO2e per declared unit
  declared_unit text NOT NULL,
  stages      jsonb NOT NULL,
  inputs      jsonb NOT NULL,
  dq          numeric,
  verified_name text, published_name text, published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, version)
);

ALTER TABLE supplier_ef ADD COLUMN IF NOT EXISTS lca_product_id uuid REFERENCES lca_product(id) ON DELETE SET NULL;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['lca_product', 'lca_input', 'lca_scenario', 'lca_publication'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

-- The library: shared rows (no company) are readable by everyone and changed only by the platform.
ALTER TABLE lci_factor ENABLE ROW LEVEL SECURITY;
ALTER TABLE lci_factor FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lci_factor;
DROP POLICY IF EXISTS lci_read ON lci_factor;
DROP POLICY IF EXISTS lci_write ON lci_factor;
CREATE POLICY lci_read ON lci_factor FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on');
CREATE POLICY lci_write ON lci_factor FOR ALL
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on');

INSERT INTO lci_factor (tenant_id, code, name, unit, co2e, stage, source, indicative) VALUES
  (NULL, 'steel_p',  'Steel, primary (BF-BOF)',                   'kg',    2.1,    'raw', 'Indicative factor — replace with licensed ecoinvent / EF 3.1 data', true),
  (NULL, 'steel_r',  'Steel, recycled (EAF)',                     'kg',    0.7,    'raw', 'Indicative factor — replace with licensed ecoinvent / EF 3.1 data', true),
  (NULL, 'alu_p',    'Aluminium, primary',                        'kg',    8.6,    'raw', 'Indicative factor — replace with licensed ecoinvent / EF 3.1 data', true),
  (NULL, 'alu_r',    'Aluminium, recycled',                       'kg',    0.6,    'raw', 'Indicative factor — replace with licensed ecoinvent / EF 3.1 data', true),
  (NULL, 'copper',   'Copper',                                    'kg',    3.8,    'raw', 'Indicative factor — replace with licensed ecoinvent / EF 3.1 data', true),
  (NULL, 'hdpe_v',   'HDPE, virgin',                              'kg',    1.9,    'raw', 'Indicative factor — replace with licensed ecoinvent / EF 3.1 data', true),
  (NULL, 'hdpe_r',   'HDPE, recycled',                            'kg',    0.5,    'raw', 'Indicative factor — replace with licensed ecoinvent / EF 3.1 data', true),
  (NULL, 'pet_v',    'PET, virgin',                               'kg',    2.2,    'raw', 'Indicative factor — replace with licensed ecoinvent / EF 3.1 data', true),
  (NULL, 'rubber',   'Synthetic rubber',                          'kg',    2.7,    'raw', 'Indicative factor — replace with licensed ecoinvent / EF 3.1 data', true),
  (NULL, 'cement',   'Cement, OPC',                               'kg',    0.85,   'raw', 'Indicative factor — replace with licensed ecoinvent / EF 3.1 data', true),
  (NULL, 'aggr_n',   'Natural aggregate',                         'kg',    0.005,  'raw', 'Indicative factor — replace with licensed ecoinvent / EF 3.1 data', true),
  (NULL, 'cd_waste', 'C&D waste feedstock (burden-free)',         'kg',    0,      'raw', 'Cut-off approach: waste enters burden-free (ISO 14067 6.4.6.3)', true),
  (NULL, 'elt',      'End-of-life tyres feedstock (burden-free)', 'kg',    0,      'raw', 'Cut-off approach: waste enters burden-free (ISO 14067 6.4.6.3)', true),
  (NULL, 'card',     'Corrugated cardboard',                      'kg',    0.9,    'packaging', 'Indicative factor — replace with licensed ecoinvent / EF 3.1 data', true),
  (NULL, 'film',     'LDPE film',                                 'kg',    2.1,    'packaging', 'Indicative factor — replace with licensed ecoinvent / EF 3.1 data', true),
  (NULL, 'pallet',   'Wooden pallet',                             'unit',  8.0,    'packaging', 'Indicative factor — replace with licensed ecoinvent / EF 3.1 data', true),
  (NULL, 'bag',      'Woven PP bulk bag',                         'unit',  4.5,    'packaging', 'Indicative factor — replace with licensed ecoinvent / EF 3.1 data', true),
  (NULL, 'grid',     'Electricity, UAE grid',                     'kWh',   0.4041, 'manufacturing', 'Indicative factor — replace with the company''s grid factor', true),
  (NULL, 'solar',    'Electricity, on-site solar (life cycle)',   'kWh',   0.04,   'manufacturing', 'Indicative factor — replace with licensed ecoinvent / EF 3.1 data', true),
  (NULL, 'diesel',   'Diesel, machinery',                         'litre', 2.7,    'manufacturing', 'Indicative factor — replace with licensed ecoinvent / EF 3.1 data', true),
  (NULL, 'lpg',      'LPG',                                       'litre', 1.56,   'manufacturing', 'Indicative factor — replace with licensed ecoinvent / EF 3.1 data', true),
  (NULL, 'water',    'Water, desalinated',                        'm³',    0.344,  'manufacturing', 'Indicative factor — replace with licensed ecoinvent / EF 3.1 data', true),
  (NULL, 'road',     'Road freight, truck >16 t',                 't-km',  0.11,   'transport', 'Indicative factor — replace with licensed ecoinvent / EF 3.1 data', true),
  (NULL, 'sea',      'Sea freight, container',                    't-km',  0.016,  'transport', 'Indicative factor — replace with licensed ecoinvent / EF 3.1 data', true),
  (NULL, 'air',      'Air freight',                               't-km',  0.6,    'transport', 'Indicative factor — replace with licensed ecoinvent / EF 3.1 data', true),
  (NULL, 'use_el',   'Use-phase electricity, UAE grid',           'kWh',   0.4041, 'use', 'Indicative factor — replace with the company''s grid factor', true),
  (NULL, 'landfill', 'Landfill, mixed waste',                     'kg',    0.467,  'eol', 'Indicative factor — replace with licensed ecoinvent / EF 3.1 data', true),
  (NULL, 'recyc',    'Recycling (collection and sorting)',        'kg',    0.021,  'eol', 'Indicative factor — replace with licensed ecoinvent / EF 3.1 data', true),
  (NULL, 'incin',    'Incineration with energy recovery',         'kg',    0.9,    'eol', 'Indicative factor — replace with licensed ecoinvent / EF 3.1 data', true)
ON CONFLICT DO NOTHING;

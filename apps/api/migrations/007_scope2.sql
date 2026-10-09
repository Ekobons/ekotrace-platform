-- Scope 2: purchased electricity, heat & steam, cooling.
--   Location-based (grid factor of the grid region) and market-based (certificates,
--   contracts, supplier factors, residual mix) side by side; Scope 3 cat. 3 parts
--   (T&D losses, well-to-tank) from the same entry.

-- ------------------------------------------------------------------- units --
INSERT INTO unit (code, name, dimension, to_base, is_base, aliases, sort) VALUES
  ('kWh_th',   'kWh (heat)',           'heat',    1,              true,  '{kWh heat,kWh thermal}', 80),
  ('MWh_th',   'MWh (heat)',           'heat',    1000,           false, '{MWh heat,MWh thermal}', 81),
  ('GJ_th',    'GJ (heat)',            'heat',    277.777777778,  false, '{GJ heat}', 82),
  ('MMBtu_th', 'MMBtu (heat)',         'heat',    293.071070172,  false, '{MMBtu heat}', 83),
  ('kWh_c',    'kWh (cooling)',        'cooling', 1,              true,  '{kWh cooling,kWhr cooling}', 90),
  ('MWh_c',    'MWh (cooling)',        'cooling', 1000,           false, '{MWh cooling}', 91),
  ('TRh',      'ton-hour of refrigeration (TRh)', 'cooling', 3.516852842, false, '{RTh,TR-h,RT-h,ton-hour,ton hour,RTH,TRH}', 92)
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------------- bases --
-- scope2        Scope 2, location-based
-- scope2_market Scope 2, market-based (also: a region's residual-mix factor)
-- td_loss       Scope 3 cat. 3: transmission & distribution losses (electricity, district heat)
-- wtt           Scope 3 cat. 3: well-to-tank (upstream) — fuels, and generation of electricity / heat
ALTER TABLE factor DROP CONSTRAINT IF EXISTS factor_basis_check;
ALTER TABLE factor ADD CONSTRAINT factor_basis_check CHECK (basis IN ('direct','wtt','outside_scopes','memo','scope2','scope2_market','td_loss'));
ALTER TABLE activity_result DROP CONSTRAINT IF EXISTS activity_result_basis_check;
ALTER TABLE activity_result ADD CONSTRAINT activity_result_basis_check CHECK (basis IN ('direct','wtt','outside_scopes','memo','scope2','scope2_market','td_loss'));
ALTER TABLE activity ADD COLUMN IF NOT EXISTS co2e_scope2_market numeric(30,9) NOT NULL DEFAULT 0;
ALTER TABLE activity ADD COLUMN IF NOT EXISTS co2e_td numeric(30,9) NOT NULL DEFAULT 0;
-- Electricity used by EVs so far: market-based = location-based (no instrument applies).
UPDATE activity SET co2e_scope2_market = co2e_scope2 WHERE co2e_scope2 <> 0 AND co2e_scope2_market = 0;

-- ------------------------------------------------------------- grid regions --
-- Country average (AE), state / emirate / province (AE-DU, ISO 3166-2) or a grid
-- sub-region (US-CAMX for eGRID…). Factors are stored with the region code.
CREATE TABLE IF NOT EXISTS grid_region (
  code     text PRIMARY KEY CHECK (code ~ '^[A-Z]{2}(-[A-Z0-9]{1,10})?$'),
  country  char(2) NOT NULL,
  name     text NOT NULL,
  kind     text NOT NULL CHECK (kind IN ('country','subnational','grid')),
  note     text,
  active   boolean NOT NULL DEFAULT true
);
INSERT INTO grid_region (code, country, name, kind, note) VALUES
  ('AE', 'AE', 'United Arab Emirates (national average)', 'country', NULL),
  ('AE-AZ', 'AE', 'Abu Dhabi (TAQA / EWEC grid)', 'subnational', NULL),
  ('AE-DU', 'AE', 'Dubai (DEWA)', 'subnational', NULL),
  ('AE-SH', 'AE', 'Sharjah (SEWA)', 'subnational', NULL),
  ('AE-AJ', 'AE', 'Ajman (EtihadWE)', 'subnational', NULL),
  ('AE-UQ', 'AE', 'Umm Al Quwain (EtihadWE)', 'subnational', NULL),
  ('AE-RK', 'AE', 'Ras Al Khaimah (EtihadWE)', 'subnational', NULL),
  ('AE-FU', 'AE', 'Fujairah (EtihadWE)', 'subnational', NULL),
  ('GB', 'GB', 'United Kingdom (DESNZ)', 'country', 'Factors loaded from DESNZ each year'),
  ('SA', 'SA', 'Saudi Arabia', 'country', NULL), ('QA', 'QA', 'Qatar', 'country', NULL), ('OM', 'OM', 'Oman', 'country', NULL),
  ('KW', 'KW', 'Kuwait', 'country', NULL), ('BH', 'BH', 'Bahrain', 'country', NULL), ('EG', 'EG', 'Egypt', 'country', NULL),
  ('IN', 'IN', 'India (national grid)', 'country', NULL), ('SG', 'SG', 'Singapore', 'country', NULL), ('US', 'US', 'United States (national average)', 'country', NULL)
ON CONFLICT (code) DO NOTHING;

-- The facility's grid region (NULL = its country's national average).
ALTER TABLE org_node ADD COLUMN IF NOT EXISTS grid_region text REFERENCES grid_region(code);

-- --------------------------------------------------------------- catalogue --
UPDATE category SET active = true, name = 'Electricity, heat & cooling', sort = 30,
  description = 'Purchased electricity, heat & steam, and cooling (Scope 2), location- and market-based, with transmission losses and upstream emissions (Scope 3.3).'
 WHERE code = 'purchased_electricity';
UPDATE subcategory SET name = 'Electricity', units = '{kWh_e,MWh_e}', default_unit = 'kWh_e' WHERE code = 'grid';
INSERT INTO subcategory (category_id, code, name, units, default_unit, sort)
SELECT c.id, v.code, v.name, v.units::text[], v.def, v.sort
FROM category c, (VALUES
  ('heat_steam', 'Heat & steam', '{kWh_th,MWh_th,GJ_th,MMBtu_th}', 'kWh_th', 2),
  ('cooling',    'Cooling (district cooling)', '{TRh,kWh_c,MWh_c}', 'TRh', 3)
) AS v(code, name, units, def, sort)
WHERE c.code = 'purchased_electricity'
ON CONFLICT (category_id, code) DO NOTHING;
UPDATE item SET name = 'Grid electricity', note = 'Location-based: grid factor of the grid region. Market-based: certificates, contracts, supplier factor, residual mix.' WHERE code = 'grid:electricity';
INSERT INTO item (subcategory_id, code, name, default_unit, note, sort)
SELECT s.id, v.code, v.name, v.def, v.note, 1
FROM subcategory s JOIN (VALUES
  ('heat_steam', 'heat:district', 'Heat & steam (district or bought)', 'kWh_th', 'UK: DESNZ district heat & steam. Elsewhere: the supplier''s factor.'),
  ('cooling', 'cooling:district', 'District cooling', 'TRh', 'Supplier''s factor per TRh, or plant efficiency (kWh electricity per TRh, or COP) × grid factor.')
) AS v(sub, code, name, def, note) ON v.sub = s.code
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------ supplier factors --
-- Market-based factor of a supplier (utility, district-cooling or heat company), per period.
-- tenant_id NULL = shared list (platform admin); otherwise the company's own.
CREATE TABLE IF NOT EXISTS supplier_factor (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid REFERENCES tenant(id) ON DELETE CASCADE,
  supplier      text NOT NULL,
  energy        text NOT NULL CHECK (energy IN ('electricity','heat','cooling')),
  region        text REFERENCES grid_region(code),
  co2e          numeric(20,10) NOT NULL CHECK (co2e >= 0),     -- kg CO2e per unit
  unit          text NOT NULL REFERENCES unit(code),
  renewable_pct numeric(5,2) CHECK (renewable_pct BETWEEN 0 AND 100),
  valid_from    date NOT NULL,
  valid_to      date NOT NULL CHECK (valid_to >= valid_from),
  source        text NOT NULL,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE supplier_factor ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_factor FORCE ROW LEVEL SECURITY;
CREATE POLICY supplier_read ON supplier_factor FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on');
CREATE POLICY supplier_write ON supplier_factor FOR ALL
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on');

-- ------------------------------------------- certificates and contracts --
-- Energy attribute certificates (I-REC, REC, GO, REGO…), PPAs and green tariffs the
-- company holds. Each MWh can be claimed once: claims are recorded per entry and
-- can never exceed the certificate's MWh.
CREATE TABLE IF NOT EXISTS energy_certificate (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  facility_id   uuid REFERENCES org_node(id),            -- NULL = any facility of the company
  instrument    text NOT NULL CHECK (instrument IN ('certificate','ppa','green_tariff','other')),
  standard      text,                                    -- I-REC, REC, GO, REGO, TIGR…
  technology    text NOT NULL CHECK (technology IN ('solar','wind','hydro','biomass','biogas','geothermal','nuclear','other')),
  mwh           numeric(20,6) NOT NULL CHECK (mwh > 0),
  co2e_per_kwh  numeric(20,10) NOT NULL DEFAULT 0 CHECK (co2e_per_kwh >= 0),
  market        char(2) NOT NULL,                        -- country of the market the instrument belongs to
  vintage_from  date NOT NULL,
  vintage_to    date NOT NULL CHECK (vintage_to >= vintage_from),
  reference     text,                                    -- registry, serial numbers, contract no.
  supplier      text,
  retired_on    date,
  note          text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS certificate_claim (
  id              bigserial PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  certificate_id  uuid NOT NULL REFERENCES energy_certificate(id),
  activity_id     uuid NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
  kwh             numeric(20,6) NOT NULL CHECK (kwh > 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (certificate_id, activity_id)
);
CREATE INDEX IF NOT EXISTS certificate_claim_cert ON certificate_claim(certificate_id);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['energy_certificate','certificate_claim'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

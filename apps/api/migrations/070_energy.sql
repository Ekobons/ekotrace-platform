-- Energy management & savings (a package of its own: tenant.products 'energy').
--   en_site     a site in the energy programme: type, floor area, baseline year, model (energy target, variables),
--               EnPI driver, tariffs and (without the GHG inventory) emission factors by carrier, target
--   en_month    a site's month: relevant variables (production, degree days, occupancy) and energy typed by carrier
--               (replaces the inventory's figure for that carrier and month; the only source without the inventory)
--   en_measure  an energy-saving measure: status, carrier, expected and verified kWh a year, cost, life, IPMVP option
--   en_seu      a significant energy use (ISO 50001 energy review): share, variables, EnPI, controls, owner
SELECT set_config('app.platform', 'on', true);

ALTER TABLE tenant DROP CONSTRAINT IF EXISTS tenant_products_check;
ALTER TABLE tenant ADD CONSTRAINT tenant_products_check CHECK (products <@ ARRAY['ekotrace', 'ekofin', 'cbam', 'ccts', 'brsr', 'uaemrv', 'energy']::text[] AND cardinality(products) >= 1);

CREATE TABLE IF NOT EXISTS en_site (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  node_id         uuid REFERENCES org_node(id) ON DELETE SET NULL,
  name            text NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  site_type       text NOT NULL DEFAULT 'other' CHECK (site_type IN ('office', 'warehouse', 'retail', 'hotel', 'hospital', 'school', 'data_centre', 'plant', 'utility', 'residential', 'other')),
  floor_m2        numeric CHECK (floor_m2 IS NULL OR floor_m2 > 0),
  baseline_year   int CHECK (baseline_year IS NULL OR baseline_year BETWEEN 2000 AND 2100),
  model_target    text NOT NULL DEFAULT 'total' CHECK (model_target IN ('total', 'electricity', 'fuel', 'heat', 'cooling', 'transport')),
  model_vars      text[] NOT NULL DEFAULT '{}' CHECK (model_vars <@ ARRAY['production', 'cdd', 'hdd', 'occupancy']::text[] AND cardinality(model_vars) <= 2),
  enpi_var        text CHECK (enpi_var IS NULL OR enpi_var IN ('production', 'cdd', 'hdd', 'occupancy', 'floor')),
  production_unit text CHECK (production_unit IS NULL OR length(production_unit) <= 40),
  tariffs         jsonb NOT NULL DEFAULT '{}',          -- carrier → currency per kWh
  factors         jsonb NOT NULL DEFAULT '{}',          -- carrier → kgCO2e per kWh (without the GHG inventory)
  target_pct      numeric CHECK (target_pct IS NULL OR (target_pct > 0 AND target_pct < 100)),
  target_year     int CHECK (target_year IS NULL OR target_year BETWEEN 2000 AND 2100),
  notes           text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  created_name    text, updated_name text, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS en_month (
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  site_id         uuid NOT NULL REFERENCES en_site(id) ON DELETE CASCADE,
  month           date NOT NULL CHECK (extract(day FROM month) = 1),
  production      numeric CHECK (production IS NULL OR production >= 0),
  cdd             numeric CHECK (cdd IS NULL OR cdd >= 0),
  hdd             numeric CHECK (hdd IS NULL OR hdd >= 0),
  occupancy       numeric CHECK (occupancy IS NULL OR occupancy >= 0),
  energy          jsonb NOT NULL DEFAULT '{}',          -- carrier → kWh typed
  note            text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  updated_name    text, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, month)
);

CREATE TABLE IF NOT EXISTS en_measure (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  site_id         uuid NOT NULL REFERENCES en_site(id) ON DELETE CASCADE,
  title           text NOT NULL CHECK (length(title) BETWEEN 2 AND 300),
  category        text NOT NULL CHECK (category IN ('lighting', 'hvac', 'motors', 'compressed_air', 'heat_recovery', 'insulation', 'controls', 'process', 'solar', 'fuel_switch', 'behaviour', 'other')),
  carrier         text NOT NULL CHECK (carrier IN ('electricity', 'fuel', 'heat', 'cooling', 'transport')),
  status          text NOT NULL CHECK (status IN ('idea', 'approved', 'implemented', 'verified', 'dropped')),
  implemented_on  date,
  kwh_expected    numeric CHECK (kwh_expected IS NULL OR kwh_expected >= 0),   -- a year
  kwh_verified    numeric CHECK (kwh_verified IS NULL OR kwh_verified >= 0),   -- a year, measured (IPMVP A/B) or allocated (C)
  ipmvp           text CHECK (ipmvp IS NULL OR ipmvp IN ('A', 'B', 'C', 'D')),
  capex           numeric CHECK (capex IS NULL OR capex >= 0),
  opex_year       numeric CHECK (opex_year IS NULL OR opex_year >= 0),
  life_years      int CHECK (life_years IS NULL OR life_years BETWEEN 1 AND 50),
  owner           text CHECK (owner IS NULL OR length(owner) <= 120),
  mv_plan         text NOT NULL DEFAULT '' CHECK (length(mv_plan) <= 2000),
  note            text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  created_name    text, updated_name text, updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS en_seu (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  site_id         uuid NOT NULL REFERENCES en_site(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  carrier         text NOT NULL CHECK (carrier IN ('electricity', 'fuel', 'heat', 'cooling', 'transport')),
  share_pct       numeric CHECK (share_pct IS NULL OR (share_pct >= 0 AND share_pct <= 100)),
  variables       text NOT NULL DEFAULT '' CHECK (length(variables) <= 500),
  enpi            text NOT NULL DEFAULT '' CHECK (length(enpi) <= 300),
  controls        text NOT NULL DEFAULT '' CHECK (length(controls) <= 1000),
  owner           text CHECK (owner IS NULL OR length(owner) <= 120),
  created_name    text, created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['en_site', 'en_month', 'en_measure', 'en_seu'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

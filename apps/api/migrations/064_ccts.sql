-- India Carbon Credit Trading Scheme (CCTS), compliance mechanism: GHG emission intensity (GEI) of an obligated
-- entity against the target notified by MoEFCC (Greenhouse Gases Emission Intensity Target Rules, 2025), following
-- BEE's Detailed Procedure for Compliance Mechanism (v1.0, July 2024):
--
--   GEI (tCO2e per tonne of equivalent product) = total emissions / equivalent product output
--   total emissions = direct energy + direct process (CO2, PFCs) + purchased electricity and heat
--                     − exported power − CO2 transferred out for permanent storage or use
--   CCCs issued     = (target GEI − achieved GEI) × output, when below target
--   CCCs to surrender = (achieved GEI − target GEI) × output, when above target
--
--   ccts_entity   an obligated entity as listed in the gazette schedule: registration no., sector, baseline FY 2023-24
--                 output and GEI, the CEA grid factor of the baseline year, the EKOTRACE facilities inside its boundary
--   ccts_target   the notified target GEI per compliance year (FY 2025-26 = 2025)
--   ccts_month    monthly output and the emission components that are not taken from EKOTRACE entries
--   ccts_ccc      the entity's Carbon Credit Certificate account: issued, bought, sold, surrendered
--   ccts_measure  emission-reduction measures reported in Form A
SELECT set_config('app.platform', 'on', true);

CREATE TABLE IF NOT EXISTS ccts_entity (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  registration_no  text CHECK (registration_no IS NULL OR length(registration_no) <= 80),
  sector           text NOT NULL CHECK (sector IN ('aluminium', 'secondary_aluminium', 'cement', 'chlor_alkali', 'pulp_paper', 'refinery',
                                                   'petrochemical', 'textile', 'iron_steel', 'fertiliser', 'other')),
  sub_sector       text CHECK (sub_sector IS NULL OR length(sub_sector) <= 120),
  state            text CHECK (state IS NULL OR length(state) <= 80),
  address          text CHECK (address IS NULL OR length(address) <= 400),
  output_unit      text NOT NULL DEFAULT 't' CHECK (length(output_unit) BETWEEN 1 AND 40),      -- t of equivalent product; refinery: MBBLS × NRGF
  product          text CHECK (product IS NULL OR length(product) <= 120),                    -- e.g. Cement equivalent, Primary aluminium
  baseline_output  numeric CHECK (baseline_output IS NULL OR baseline_output > 0),             -- FY 2023-24
  baseline_gei     numeric CHECK (baseline_gei IS NULL OR baseline_gei > 0),
  grid_ef          numeric NOT NULL DEFAULT 0.727 CHECK (grid_ef >= 0 AND grid_ef <= 5),        -- tCO2/MWh, CEA average of the baseline year, held constant
  energy_source    text NOT NULL DEFAULT 'entries' CHECK (energy_source IN ('entries', 'manual')), -- fuel and grid electricity from EKOTRACE entries or typed monthly
  facility_ids     uuid[] NOT NULL DEFAULT '{}',
  acva             text CHECK (acva IS NULL OR length(acva) <= 200),                          -- accredited carbon verification agency
  price_inr        numeric CHECK (price_inr IS NULL OR price_inr >= 0),                       -- CCC price assumption per tCO2e
  notes            text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  created_name     text, created_at timestamptz NOT NULL DEFAULT now(),
  updated_name     text, updated_at timestamptz
);
CREATE INDEX IF NOT EXISTS ccts_entity_t ON ccts_entity (tenant_id, name);

CREATE TABLE IF NOT EXISTS ccts_target (
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  entity_id   uuid NOT NULL REFERENCES ccts_entity(id) ON DELETE CASCADE,
  fy          int NOT NULL CHECK (fy BETWEEN 2023 AND 2100),        -- 2025 = FY 2025-26 (April 2025 – March 2026)
  target_gei  numeric NOT NULL CHECK (target_gei > 0),
  PRIMARY KEY (entity_id, fy)
);

CREATE TABLE IF NOT EXISTS ccts_month (
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  entity_id     uuid NOT NULL REFERENCES ccts_entity(id) ON DELETE CASCADE,
  month         date NOT NULL CHECK (extract(day FROM month) = 1),
  output        numeric CHECK (output IS NULL OR output >= 0),       -- equivalent product in the entity's unit
  fuel_t        numeric CHECK (fuel_t IS NULL OR fuel_t >= 0),       -- direct energy emissions, tCO2e (manual mode, or an override)
  process_t     numeric CHECK (process_t IS NULL OR process_t >= 0), -- process CO2 (calcination, anodes, reductants…)
  pfc_t         numeric CHECK (pfc_t IS NULL OR pfc_t >= 0),         -- PFCs as tCO2e (AR5)
  grid_mwh      numeric CHECK (grid_mwh IS NULL OR grid_mwh >= 0),   -- purchased grid electricity (manual mode, or an override)
  re_mwh        numeric CHECK (re_mwh IS NULL OR re_mwh >= 0),       -- of which documented renewable (zero emissions)
  heat_t        numeric CHECK (heat_t IS NULL OR heat_t >= 0),       -- purchased heat / steam, supplier factor, tCO2e
  export_mwh    numeric CHECK (export_mwh IS NULL OR export_mwh >= 0),
  export_ef     numeric CHECK (export_ef IS NULL OR (export_ef >= 0 AND export_ef <= 5)),   -- heat-rate based factor; default the grid factor
  transfer_t    numeric CHECK (transfer_t IS NULL OR transfer_t >= 0), -- CO2 transferred out for permanent storage or use
  note          text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  updated_name  text, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_id, month)
);

CREATE TABLE IF NOT EXISTS ccts_ccc (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  entity_id   uuid NOT NULL REFERENCES ccts_entity(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('issued', 'bought', 'sold', 'surrendered')),
  fy          int NOT NULL CHECK (fy BETWEEN 2023 AND 2100),        -- the compliance year it is issued for / used for
  quantity    numeric NOT NULL CHECK (quantity > 0 AND quantity <= 1e9),
  price_inr   numeric CHECK (price_inr IS NULL OR price_inr >= 0),
  on_date     date NOT NULL,
  reference   text CHECK (reference IS NULL OR length(reference) <= 200),   -- registry transaction, exchange trade id
  note        text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  created_name text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ccts_ccc_e ON ccts_ccc (entity_id, on_date);

CREATE TABLE IF NOT EXISTS ccts_measure (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  entity_id     uuid NOT NULL REFERENCES ccts_entity(id) ON DELETE CASCADE,
  fy            int NOT NULL CHECK (fy BETWEEN 2023 AND 2100),
  title         text NOT NULL CHECK (length(title) BETWEEN 2 AND 300),
  year_done     int CHECK (year_done IS NULL OR year_done BETWEEN 1990 AND 2100),
  before_t      numeric CHECK (before_t IS NULL OR before_t >= 0),   -- tCO2e a year before the measure
  after_t       numeric CHECK (after_t IS NULL OR after_t >= 0),
  investment_inr numeric CHECK (investment_inr IS NULL OR investment_inr >= 0),
  note          text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  created_name  text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ccts_measure_e ON ccts_measure (entity_id, fy);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['ccts_entity', 'ccts_target', 'ccts_month', 'ccts_ccc', 'ccts_measure'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

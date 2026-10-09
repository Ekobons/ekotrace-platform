-- =============================================================================
-- 001 — Core reference data, editable emission catalogue, factors, activity.
--
-- Layout
--   Reference      gas, gwp_set, gwp_value, unit
--   Catalogue      category → subcategory → item   (all editable by the platform
--                  admin; "remove" = switch off, so past entries stay valid)
--                  item_gas (composition of blends), tenant_catalogue (per client)
--   Factors        factor_source, factor (one per item/unit/basis/period/region),
--                  factor_gas (kg of each gas per unit)
--   Clients        tenant, facility
--   Activity       activity (what was entered), activity_result (per gas)
--
-- Client data (tenant, facility, activity…) is protected by PostgreSQL
-- row-level security: every query runs with app.tenant_id set, and a row of
-- another client is invisible even if application code has a bug.
-- =============================================================================

-- ---------------------------------------------------------------- reference --
CREATE TABLE gas (
  code        text PRIMARY KEY,                 -- 'CO2', 'CH4', 'CH4_fossil', 'N2O', 'HFC-134a', 'SF6'…
  name        text NOT NULL,
  formula     text,
  family      text NOT NULL,                    -- CO2 | CH4 | N2O | HFC | PFC | SF6 | NF3 | HCFC | CFC | Halon | HFO | Other
  kyoto       boolean NOT NULL,                 -- Kyoto basket → counted in scopes; others → memo
  aliases     text[] NOT NULL DEFAULT '{}',     -- names used by sources, e.g. DESNZ 'HCFC-22/R22 = chlorodifluoromethane'
  sort        int NOT NULL DEFAULT 100
);

CREATE TABLE gwp_set (
  code        text PRIMARY KEY,                 -- 'AR4' | 'AR5' | 'AR6'
  name        text NOT NULL,
  note        text
);

CREATE TABLE gwp_value (
  gwp_set     text NOT NULL REFERENCES gwp_set(code),
  gas         text NOT NULL REFERENCES gas(code),
  value       numeric(14,4) NOT NULL CHECK (value >= 0),
  source      text NOT NULL,
  PRIMARY KEY (gwp_set, gas)
);

CREATE TABLE unit (
  code        text PRIMARY KEY,                 -- 'kg', 't', 'L', 'kWh', 'kWh_gcv'…
  name        text NOT NULL,
  dimension   text NOT NULL,                    -- mass | volume | energy_net | energy_gross | …
  to_base     numeric(30,15) NOT NULL CHECK (to_base > 0),
  is_base     boolean NOT NULL DEFAULT false,
  aliases     text[] NOT NULL DEFAULT '{}',     -- spellings found in imports: 'tonnes', 'litres'…
  sort        int NOT NULL DEFAULT 100,
  active      boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX unit_one_base_per_dimension ON unit(dimension) WHERE is_base;

-- ---------------------------------------------------------------- catalogue --
-- How a category is calculated. Adding a category of an existing kind needs no code.
CREATE TABLE category (
  id          serial PRIMARY KEY,
  scope       smallint NOT NULL CHECK (scope IN (1,2,3)),
  code        text NOT NULL UNIQUE,             -- 'stationary_combustion', 'fugitive'…
  name        text NOT NULL,
  calc_method text NOT NULL CHECK (calc_method IN ('combustion','fugitive')),
  description text,
  sort        int NOT NULL DEFAULT 100,
  active      boolean NOT NULL DEFAULT true
);

CREATE TABLE subcategory (
  id            serial PRIMARY KEY,
  category_id   int NOT NULL REFERENCES category(id),
  code          text NOT NULL,                  -- 'liquid_fuels'…
  name          text NOT NULL,
  units         text[] NOT NULL DEFAULT '{}',   -- units offered in data entry (empty = all the item's factor units)
  default_unit  text REFERENCES unit(code),
  is_bioenergy  boolean NOT NULL DEFAULT false, -- biogenic CO2 reported outside scopes
  sort          int NOT NULL DEFAULT 100,
  active        boolean NOT NULL DEFAULT true,
  UNIQUE (category_id, code)
);

CREATE TABLE item (
  id              serial PRIMARY KEY,
  subcategory_id  int NOT NULL REFERENCES subcategory(id),
  code            text NOT NULL UNIQUE,         -- stable key used by imports: 'desnz:diesel-100-mineral'
  name            text NOT NULL,
  aliases         text[] NOT NULL DEFAULT '{}', -- other names (old Ekotrace names, source spellings)
  default_unit    text REFERENCES unit(code),
  gas_code        text REFERENCES gas(code),    -- fugitive: a single pure gas
  note            text,
  sort            int NOT NULL DEFAULT 100,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX item_subcategory ON item(subcategory_id) WHERE active;

-- Composition of blends by mass (R-410A = 0.5 HFC-32 + 0.5 HFC-125).
CREATE TABLE item_gas (
  item_id   int NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  gas       text NOT NULL REFERENCES gas(code),
  fraction  numeric(8,6) NOT NULL CHECK (fraction > 0 AND fraction <= 1),
  source    text,
  PRIMARY KEY (item_id, gas)
);

-- ------------------------------------------------------------------ factors --
CREATE TABLE factor_source (
  id          serial PRIMARY KEY,
  code        text NOT NULL UNIQUE,             -- 'DESNZ-2026', 'IPCC-2006'
  publisher   text NOT NULL,
  title       text NOT NULL,
  year        int,
  version     text,
  gwp_set     text REFERENCES gwp_set(code),    -- GWP set the source used for its CO2e totals
  url         text,
  licence     text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  file_sha256 text
);

CREATE TABLE factor (
  id            bigserial PRIMARY KEY,
  item_id       int NOT NULL REFERENCES item(id),
  source_id     int NOT NULL REFERENCES factor_source(id),
  region        text NOT NULL DEFAULT 'GLOBAL', -- ISO 3166 country code or GLOBAL
  basis         text NOT NULL CHECK (basis IN ('direct','wtt','outside_scopes','memo')),
  unit          text NOT NULL REFERENCES unit(code),
  co2e          numeric(30,15),                 -- kg CO2e per unit as published (source GWP set)
  valid_from    date NOT NULL,
  valid_to      date NOT NULL CHECK (valid_to >= valid_from),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','retired')),
  version       int NOT NULL DEFAULT 1,
  supersedes_id bigint REFERENCES factor(id),
  note          text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- One active factor per item / region / basis / unit / start date.
CREATE UNIQUE INDEX factor_one_active ON factor(item_id, region, basis, unit, valid_from) WHERE status = 'active';
CREATE INDEX factor_lookup ON factor(item_id, status, valid_from);

CREATE TABLE factor_gas (
  factor_id    bigint NOT NULL REFERENCES factor(id) ON DELETE CASCADE,
  gas          text NOT NULL REFERENCES gas(code),
  kg_per_unit  numeric(30,15) NOT NULL,
  PRIMARY KEY (factor_id, gas)
);

-- Problems found while importing a source file, for an admin to review.
CREATE TABLE import_issue (
  id          bigserial PRIMARY KEY,
  source_id   int REFERENCES factor_source(id),
  severity    text NOT NULL CHECK (severity IN ('info','warning','error')),
  message     text NOT NULL,
  detail      jsonb,
  resolved    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------ clients --
CREATE TABLE tenant (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  country     text NOT NULL DEFAULT 'AE',
  gwp_set     text NOT NULL DEFAULT 'AR5' REFERENCES gwp_set(code),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Per-client catalogue: switch a whole subcategory or a single item off (or on).
CREATE TABLE tenant_catalogue (
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  subcategory_id  int REFERENCES subcategory(id),
  item_id         int REFERENCES item(id),
  enabled         boolean NOT NULL,
  CHECK ((subcategory_id IS NULL) <> (item_id IS NULL))
);
CREATE UNIQUE INDEX tenant_catalogue_sub ON tenant_catalogue(tenant_id, subcategory_id) WHERE subcategory_id IS NOT NULL;
CREATE UNIQUE INDEX tenant_catalogue_item ON tenant_catalogue(tenant_id, item_id) WHERE item_id IS NOT NULL;

CREATE TABLE facility (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name        text NOT NULL,
  country     text NOT NULL DEFAULT 'AE',
  active      boolean NOT NULL DEFAULT true
);
CREATE INDEX facility_tenant ON facility(tenant_id);

-- ----------------------------------------------------------------- activity --
CREATE TABLE activity (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  facility_id   uuid NOT NULL REFERENCES facility(id),
  category_id   int NOT NULL REFERENCES category(id),
  item_id       int NOT NULL REFERENCES item(id),
  period_start  date NOT NULL,
  period_end    date NOT NULL CHECK (period_end >= period_start),
  quantity      numeric(30,9) NOT NULL,          -- combustion: fuel quantity; fugitive: see inputs
  unit          text NOT NULL REFERENCES unit(code),
  inputs        jsonb NOT NULL DEFAULT '{}',     -- method-specific inputs (fugitive method data)
  data_type     text NOT NULL DEFAULT 'actual' CHECK (data_type IN ('actual','estimated','proxy')),
  gwp_set       text NOT NULL REFERENCES gwp_set(code),
  co2e_direct   numeric(30,9) NOT NULL,          -- kg CO2e, copies of the result totals for fast dashboards
  co2e_wtt      numeric(30,9) NOT NULL DEFAULT 0,
  co2_biogenic  numeric(30,9) NOT NULL DEFAULT 0,
  co2e_memo     numeric(30,9) NOT NULL DEFAULT 0,
  steps         jsonb NOT NULL,                  -- calculation steps (audit trail)
  warnings      jsonb NOT NULL DEFAULT '[]',
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected')),
  note          text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_tenant_period ON activity(tenant_id, period_start);
CREATE INDEX activity_facility ON activity(facility_id, period_start);

CREATE TABLE activity_result (
  activity_id  uuid NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES tenant(id),
  basis        text NOT NULL CHECK (basis IN ('direct','wtt','outside_scopes','memo')),
  gas          text NOT NULL,                    -- gas code, or 'CO2e' when only a total is known
  kg_gas       numeric(30,9),
  kg_co2e      numeric(30,9) NOT NULL,
  factor_id    bigint REFERENCES factor(id),
  method       text NOT NULL CHECK (method IN ('gas','published'))
);
CREATE INDEX activity_result_activity ON activity_result(activity_id);

-- ------------------------------------------------------- row-level security --
-- The API sets `app.tenant_id` per request (SET LOCAL inside a transaction).
-- Platform jobs that must see all clients connect as the table owner.
-- FORCE makes the rules apply to the table owner too. Only code that runs as
-- platform staff sets app.platform = 'on' (never from client-supplied input).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['facility','activity','activity_result','tenant_catalogue'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
             OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
             OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

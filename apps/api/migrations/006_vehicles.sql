-- Vehicles (mobile combustion), EV charging in Scope 2, fleet register, price list.
--
--   Vehicle types are catalogue items (class × powertrain, e.g. "Medium car · Diesel")
--   with DESNZ factors per km and per mile. Fuel-based entries use the fuel items of
--   stationary combustion. Electric driving: kWh per km (vehicle_energy) × the grid
--   factor of the facility's country (item grid:electricity, one factor per country),
--   reported in Scope 2.

-- ------------------------------------------------------------------ units --
INSERT INTO unit (code, name, dimension, to_base, is_base, aliases, sort) VALUES
  ('km',    'km',             'distance',    1,        true,  '{kilometre,kilometres,kilometer,kms}', 60),
  ('mi',    'mile',           'distance',    1.609344, false, '{miles,mile}', 61),
  ('kWh_e', 'kWh (electricity)', 'electricity', 1,     true,  '{kWh electricity}', 70),
  ('MWh_e', 'MWh (electricity)', 'electricity', 1000,  false, '{MWh electricity}', 71)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE factor_source ADD COLUMN IF NOT EXISTS importer_version int NOT NULL DEFAULT 1;

-- ------------------------------------------------------------ Scope 2 basis --
-- 'scope2': electricity bought for EV charging (location-based grid factor).
ALTER TABLE factor DROP CONSTRAINT IF EXISTS factor_basis_check;
ALTER TABLE factor ADD CONSTRAINT factor_basis_check CHECK (basis IN ('direct','wtt','outside_scopes','memo','scope2'));
ALTER TABLE activity_result DROP CONSTRAINT IF EXISTS activity_result_basis_check;
ALTER TABLE activity_result ADD CONSTRAINT activity_result_basis_check CHECK (basis IN ('direct','wtt','outside_scopes','memo','scope2'));
ALTER TABLE activity ADD COLUMN IF NOT EXISTS co2e_scope2 numeric(30,9) NOT NULL DEFAULT 0;

-- --------------------------------------------------------------- catalogue --
ALTER TABLE category DROP CONSTRAINT IF EXISTS category_calc_method_check;
ALTER TABLE category ADD CONSTRAINT category_calc_method_check CHECK (calc_method IN ('combustion','fugitive','vehicle','electricity'));

-- Attributes of an item used by a calculation: for vehicles
-- {"vehicle":"Medium car","powertrain":"Diesel","fuel":"desnz:diesel-100-mineral-diesel","electric":false}
ALTER TABLE item ADD COLUMN IF NOT EXISTS attrs jsonb NOT NULL DEFAULT '{}';

INSERT INTO category (scope, code, name, calc_method, description, sort) VALUES
  (1, 'mobile_combustion', 'Vehicles', 'vehicle',
      'Company-owned or leased vehicles: cars, vans, trucks, motorbikes. Enter distance, fuel or spend; electric driving is reported in Scope 2.', 15),
  (2, 'purchased_electricity', 'Purchased electricity', 'electricity',
      'Grid electricity. Used now for EV charging; full Scope 2 data entry comes later.', 30)
ON CONFLICT (code) DO NOTHING;
UPDATE category SET active = false WHERE code = 'purchased_electricity';

-- Heading a subcategory is listed under in data entry (e.g. Passenger / Delivery vehicles).
ALTER TABLE subcategory ADD COLUMN IF NOT EXISTS grp text;

INSERT INTO subcategory (category_id, code, name, grp, units, default_unit, sort)
SELECT c.id, v.code, v.name, v.grp, v.units::text[], v.def, v.sort
FROM category c, (VALUES
  ('cars_by_size',     'Cars (by size)',                      'Passenger vehicles', '{km,mi}', 'km', 1),
  ('cars_by_segment',  'Cars (by market segment)',            'Passenger vehicles', '{km,mi}', 'km', 2),
  ('motorbikes',       'Motorbikes',                          'Passenger vehicles', '{km,mi}', 'km', 3),
  ('vans',             'Vans (up to 3.5 t)',                  'Delivery vehicles',  '{km,mi}', 'km', 4),
  ('hgv',              'Trucks / HGV (diesel)',               'Delivery vehicles',  '{km,mi}', 'km', 5),
  ('hgv_refrigerated', 'Refrigerated trucks / HGV (diesel)',  'Delivery vehicles',  '{km,mi}', 'km', 6),
  ('machinery',        'Off-road machinery (fuel or spend)',  'Off-road machinery', '{}',      NULL, 7)
) AS v(code, name, grp, units, def, sort)
WHERE c.code = 'mobile_combustion'
ON CONFLICT (category_id, code) DO NOTHING;

-- Off-road machinery has no distance factors: entered by fuel used or spend, using the fuel's factors.
INSERT INTO item (subcategory_id, code, name, attrs, sort)
SELECT s.id, v.code, v.name, v.attrs::jsonb, v.sort
FROM subcategory s, (VALUES
  ('mach:diesel', 'Machinery · Diesel (forklift, loader, excavator, sweeper, generator)', '{"vehicle":"Off-road machinery","powertrain":"Diesel","fuel":"desnz:diesel-100-mineral-diesel","distance":false}', 1),
  ('mach:petrol', 'Machinery · Petrol',  '{"vehicle":"Off-road machinery","powertrain":"Petrol","fuel":"desnz:petrol-100-mineral-petrol","distance":false}', 2),
  ('mach:lpg',    'Machinery · LPG (e.g. forklift)', '{"vehicle":"Off-road machinery","powertrain":"LPG","fuel":"desnz:lpg","distance":false}', 3),
  ('mach:cng',    'Machinery · CNG',     '{"vehicle":"Off-road machinery","powertrain":"CNG","fuel":"desnz:cng","distance":false}', 4),
  ('mach:electric', 'Machinery · Electric (e.g. forklift)', '{"vehicle":"Off-road machinery","powertrain":"Battery Electric Vehicle","electric":true,"distance":false}', 5)
) AS v(code, name, attrs, sort)
WHERE s.code = 'machinery'
ON CONFLICT (code) DO NOTHING;

INSERT INTO subcategory (category_id, code, name, units, default_unit, sort)
SELECT c.id, 'grid', 'Grid electricity', '{kWh_e,MWh_e}'::text[], 'kWh_e', 1 FROM category c WHERE c.code = 'purchased_electricity'
ON CONFLICT (category_id, code) DO NOTHING;

INSERT INTO item (subcategory_id, code, name, default_unit, note, sort)
SELECT s.id, 'grid:electricity', 'Grid electricity (location-based)', 'kWh_e',
       'One factor per country (region). UK values from DESNZ; other countries are entered in the factor library with their source.', 1
FROM subcategory s WHERE s.code = 'grid'
ON CONFLICT (code) DO NOTHING;

-- Electricity used per km (or mile) by electric and plug-in hybrid vehicles (DESNZ "SECR kWh UK electricity for EVs").
CREATE TABLE IF NOT EXISTS vehicle_energy (
  id            bigserial PRIMARY KEY,
  item_id       int NOT NULL REFERENCES item(id),
  source_id     int NOT NULL REFERENCES factor_source(id),
  unit          text NOT NULL REFERENCES unit(code),     -- km | mi
  kwh_per_unit  numeric(20,10) NOT NULL CHECK (kwh_per_unit >= 0),
  valid_from    date NOT NULL,
  valid_to      date NOT NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded'))
);
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_energy_one ON vehicle_energy(item_id, unit, valid_from) WHERE status = 'active';

-- ---------------------------------------------------------- price list --
-- For spend-based entries: spend ÷ price = quantity. tenant_id NULL = everyone (platform list);
-- a company's own price overrides it.
CREATE TABLE IF NOT EXISTS price (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES tenant(id) ON DELETE CASCADE,
  region      text NOT NULL,                       -- country code
  item_id     int NOT NULL REFERENCES item(id),    -- fuel item or grid:electricity
  currency    text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  price       numeric(20,6) NOT NULL CHECK (price > 0),
  unit        text NOT NULL REFERENCES unit(code), -- price per this unit (L, kg, kWh_e…)
  valid_from  date NOT NULL,
  valid_to    date NOT NULL CHECK (valid_to >= valid_from),
  source      text NOT NULL,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS price_lookup ON price(item_id, region, valid_from);
ALTER TABLE price ENABLE ROW LEVEL SECURITY;
ALTER TABLE price FORCE ROW LEVEL SECURITY;
CREATE POLICY price_read ON price FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on');
CREATE POLICY price_write ON price FOR ALL
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on');

-- ------------------------------------------------------------ fleet register --
CREATE TABLE IF NOT EXISTS vehicle (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  facility_id      uuid NOT NULL REFERENCES org_node(id),
  name             text NOT NULL,                  -- fleet number or description
  registration     text,
  item_id          int NOT NULL REFERENCES item(id),   -- vehicle type × powertrain
  fuel_item_id     int REFERENCES item(id),            -- fuel actually used (default from the type)
  ownership        text NOT NULL DEFAULT 'owned' CHECK (ownership IN ('owned','leased')),
  charging         text CHECK (charging IN ('site','elsewhere')),  -- electric / plug-in hybrid only
  default_method   text NOT NULL DEFAULT 'distance' CHECK (default_method IN ('distance','fuel','electricity','spend')),
  in_service_from  date NOT NULL,
  retired_on       date,
  retired_reason   text,
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (retired_on IS NULL OR retired_on >= in_service_from)
);
CREATE INDEX IF NOT EXISTS vehicle_facility ON vehicle(tenant_id, facility_id);
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_registration ON vehicle(tenant_id, lower(registration)) WHERE registration IS NOT NULL AND retired_on IS NULL;
ALTER TABLE vehicle ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vehicle
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on');

ALTER TABLE activity ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES vehicle(id);
CREATE INDEX IF NOT EXISTS activity_vehicle ON activity(vehicle_id) WHERE vehicle_id IS NOT NULL;

-- Scope 3 categories 4, 9, 8 and 13 with activity data (not only spend):
--
--   3.4  Upstream transport & distribution   — freight and storage of goods coming to the company (paid by it)
--   3.9  Downstream transport & distribution — freight and storage of goods sold, after they leave (not paid by it)
--   3.8  Upstream leased assets              — buildings and vehicles the company leases, not already in its Scope 1 and 2
--   3.13 Downstream leased assets            — buildings and vehicles the company owns and leases out to others
--
-- Calculation method 'asset':
--   * freight per tonne-km or vehicle-km, leased vehicles per km: DESNZ "Freighting goods" and
--     "Managed assets- vehicles" factors (Scope 3) with their well-to-tank — items written by the DESNZ importer;
--   * energy known (kWh of electricity, litres of diesel…): the platform's own grid and fuel factors (item attrs.via);
--   * floor area × time: a typical energy intensity of the building type (attrs.eui, kWh per m² per year,
--     from data/buildings/energy-intensity.csv) × the facility's grid factor;
--   * emissions reported by the carrier, landlord or tenant, in kg or t CO2e.
-- Spend lines moved from purchase files keep their spend item and stay in 3.4 / 3.8.
SELECT set_config('app.platform', 'on', true);

INSERT INTO unit (code, name, dimension, to_base, is_base, aliases, sort) VALUES
  ('tkm',      'tonne-km',          'freight',     1,        true,  '{tonne.km,tonne km,t.km,tkm,t-km}', 92),
  ('m2_day',   'm² × days',         'area_time',   1,        true,  '{m2 day,m2-day,sqm day}',          93),
  ('m2_month', 'm² × months',       'area_time',   30.4375,  false, '{m2 month,m2-month,sqm month}',    94),
  ('m2_year',  'm² × years',        'area_time',   365.25,   false, '{m2 year,m2-year,sqm year}',       95),
  ('kgco2e',   'kg CO₂e',           'emissions',   1,        true,  '{kg co2e,kgco2e,kg CO2e}',         96),
  ('tco2e',    'tonnes CO₂e',       'emissions',   1000,     false, '{t co2e,tco2e,tonnes co2e}',       97)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE category DROP CONSTRAINT IF EXISTS category_calc_method_check;
ALTER TABLE category ADD CONSTRAINT category_calc_method_check
  CHECK (calc_method IN ('combustion','fugitive','vehicle','electricity','waste','waste_disposal','spend','travel','trip','water','asset'));

UPDATE category SET name = 'Upstream transport & distribution (Scope 3.4)', calc_method = 'asset',
  description = 'Freight and storage of goods coming to the company, paid by it: trucks, vans, ships, trains and planes of transport companies, and third-party warehouses. By tonne-km, vehicle-km, warehouse floor area, energy, or the carrier''s reported emissions. Spend lines from purchase files are kept here too.'
 WHERE code = 'upstream_transport';
UPDATE category SET name = 'Upstream leased assets (Scope 3.8)', calc_method = 'asset',
  description = 'Buildings and vehicles the company leases (rents) that are not already in its own Scope 1 and 2 — e.g. a leased office whose energy the landlord pays. By the energy used, the floor area, or the landlord''s reported emissions; vehicles by distance or fuel. Rent lines from purchase files are kept here too.'
 WHERE code = 'upstream_leased';

INSERT INTO category (scope, code, name, calc_method, description, sort, ghg_category) VALUES
  (3, 'downstream_transport', 'Downstream transport & distribution (Scope 3.9)', 'asset',
   'Freight and storage of products sold, after they leave the company, paid by the customer or others: delivery to customers and retailers, and their warehouses. By tonne-km, vehicle-km, warehouse floor area, energy, or the carrier''s reported emissions.', 69, 9),
  (3, 'downstream_leased', 'Downstream leased assets (Scope 3.13)', 'asset',
   'Buildings and vehicles the company owns and leases out to others, whose energy the tenant uses. By the tenant''s energy use, the floor area, or the tenant''s reported emissions; vehicles by distance or fuel.', 71, 13)
ON CONFLICT (code) DO NOTHING;
UPDATE category SET sort = 63 WHERE code = 'upstream_transport';
UPDATE category SET sort = 67 WHERE code = 'upstream_leased';

-- Subcategories (codes unique across the catalogue: the importer finds them by code).
INSERT INTO subcategory (category_id, code, name, units, default_unit, sort)
SELECT c.id, v.code, v.name, v.units::text[], v.def, v.sort
FROM category c JOIN (VALUES
  ('upstream_transport',   't4_road',       'Road freight (trucks, vans)',                '{tkm,km,mi}',                 'tkm',      1),
  ('upstream_transport',   't4_other',      'Sea, air and rail freight',                  '{tkm}',                       'tkm',      2),
  ('upstream_transport',   't4_store_area', 'Warehousing — by floor area',                '{m2_month,m2_day,m2_year}',   'm2_month', 3),
  ('upstream_transport',   't4_store_kwh',  'Warehousing — energy used',                  '{}',                          NULL,       4),
  ('upstream_transport',   't4_reported',   'Emissions reported by the carrier',          '{kgco2e,tco2e}',              'kgco2e',   5),
  ('downstream_transport', 't9_road',       'Road freight (trucks, vans)',                '{tkm,km,mi}',                 'tkm',      1),
  ('downstream_transport', 't9_other',      'Sea, air and rail freight',                  '{tkm}',                       'tkm',      2),
  ('downstream_transport', 't9_store_area', 'Warehousing — by floor area',                '{m2_month,m2_day,m2_year}',   'm2_month', 3),
  ('downstream_transport', 't9_store_kwh',  'Warehousing — energy used',                  '{}',                          NULL,       4),
  ('downstream_transport', 't9_reported',   'Emissions reported by the carrier',          '{kgco2e,tco2e}',              'kgco2e',   5),
  ('upstream_leased',      'l8_bld_kwh',    'Leased buildings — energy used',             '{}',                          NULL,       1),
  ('upstream_leased',      'l8_bld_area',   'Leased buildings — by floor area',           '{m2_month,m2_day,m2_year}',   'm2_month', 2),
  ('upstream_leased',      'l8_reported',   'Emissions reported by the landlord',         '{kgco2e,tco2e}',              'kgco2e',   3),
  ('upstream_leased',      'l8_veh_km',     'Leased vehicles — by distance',              '{km,mi}',                     'km',       4),
  ('upstream_leased',      'l8_veh_fuel',   'Leased vehicles — by fuel',                  '{}',                          NULL,       5),
  ('downstream_leased',    'l13_bld_kwh',   'Leased-out buildings — energy used',         '{}',                          NULL,       1),
  ('downstream_leased',    'l13_bld_area',  'Leased-out buildings — by floor area',       '{m2_month,m2_day,m2_year}',   'm2_month', 2),
  ('downstream_leased',    'l13_reported',  'Emissions reported by the tenant',           '{kgco2e,tco2e}',              'kgco2e',   3),
  ('downstream_leased',    'l13_veh_km',    'Leased-out vehicles — by distance',          '{km,mi}',                     'km',       4),
  ('downstream_leased',    'l13_veh_fuel',  'Leased-out vehicles — by fuel',              '{}',                          NULL,       5)
) AS v(cat, code, name, units, def, sort) ON v.cat = c.code
ON CONFLICT (category_id, code) DO NOTHING;

-- Energy used (the asset's own meters or bills): the platform's grid and fuel factors.
INSERT INTO item (subcategory_id, code, name, default_unit, note, sort, attrs)
SELECT s.id, s.code || ':' || v.k, v.name, v.unit, v.note, v.sort, jsonb_build_object('via', v.via)
FROM subcategory s JOIN (VALUES
  ('electricity', 'Electricity',              'grid:electricity',                  'kWh_e', 'Grid factor of the facility''s grid region, with grid losses and upstream.', 1),
  ('natural-gas', 'Natural gas',              'desnz:natural-gas',                 'm3',    'DESNZ natural gas, with upstream (well-to-tank).', 2),
  ('diesel',      'Diesel (generator, boiler)', 'desnz:diesel-100-mineral-diesel', 'L',     'DESNZ diesel (100% mineral), with upstream.', 3),
  ('lpg',         'LPG',                      'desnz:lpg',                         'kg',    'DESNZ LPG, with upstream.', 4)
) AS v(k, name, via, unit, note, sort) ON TRUE
WHERE s.code IN ('t4_store_kwh', 't9_store_kwh', 'l8_bld_kwh', 'l13_bld_kwh')
ON CONFLICT (code) DO NOTHING;

INSERT INTO item (subcategory_id, code, name, default_unit, note, sort, attrs)
SELECT s.id, s.code || ':' || v.k, v.name, v.unit, v.note, v.sort, jsonb_build_object('via', v.via)
FROM subcategory s JOIN (VALUES
  ('diesel', 'Diesel', 'desnz:diesel-100-mineral-diesel', 'L', 'Litres bought for the leased vehicles. DESNZ diesel (100% mineral), with upstream.', 1),
  ('petrol', 'Petrol', 'desnz:petrol-100-mineral-petrol', 'L', 'Litres bought for the leased vehicles. DESNZ petrol (100% mineral), with upstream.', 2),
  ('lpg',    'LPG',    'desnz:lpg',                       'L', 'DESNZ LPG, with upstream.', 3),
  ('cng',    'CNG',    'desnz:cng',                       'kg', 'DESNZ CNG, with upstream.', 4)
) AS v(k, name, via, unit, note, sort) ON TRUE
WHERE s.code IN ('l8_veh_fuel', 'l13_veh_fuel')
ON CONFLICT (code) DO NOTHING;

-- Emissions reported by the carrier, landlord or tenant (their Scope 1 and 2 for this activity).
INSERT INTO item (subcategory_id, code, name, default_unit, note, sort, attrs)
SELECT s.id, s.code || ':reported', 'Emissions reported', 'kgco2e',
  'Their Scope 1 and 2 for your goods or your space, as they report it (e.g. a carrier''s emission statement, the landlord''s energy report). Attach the statement as evidence.', 1, '{"reported": true}'::jsonb
FROM subcategory s WHERE s.code IN ('t4_reported', 't9_reported', 'l8_reported', 'l13_reported')
ON CONFLICT (code) DO NOTHING;

-- Order of the Scope 3 tabs: by GHG Protocol category, water last.
UPDATE category SET sort = 80 WHERE code = 'water_supply';
UPDATE category SET sort = 81 WHERE code = 'water_discharge';

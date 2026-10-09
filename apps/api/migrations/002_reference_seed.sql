-- =============================================================================
-- 002 — Starting reference data: GWP sets, units, Scope 1 categories and
-- subcategories. All of it can be changed later in the admin panel; this is
-- only the starting point. Gases, GWP values, items and factors are loaded by
-- `npm run db:seed` from the data/ folder (DESNZ files, GHG Protocol GWP table).
-- =============================================================================

INSERT INTO gwp_set (code, name, note) VALUES
  ('AR4', 'IPCC Fourth Assessment Report (2007), 100-year', 'Used by DESNZ factors up to 2022'),
  ('AR5', 'IPCC Fifth Assessment Report (2014), 100-year',  'Used by DESNZ factors from 2023; UNFCCC reporting standard'),
  ('AR6', 'IPCC Sixth Assessment Report (2021), 100-year',  'Latest; separate fossil / non-fossil methane values');

-- Units. to_base = size in the base unit of the dimension.
-- Net and gross calorific value are separate dimensions on purpose (see calc/units.ts).
INSERT INTO unit (code, name, dimension, to_base, is_base, aliases, sort) VALUES
  -- mass (base kg)
  ('kg',     'kg',                   'mass', 1,              true,  '{kilogram,kilograms}', 1),
  ('t',      'tonne',                'mass', 1000,           false, '{tonnes,ton,metric ton,MT}', 2),
  ('g',      'gram',                 'mass', 0.001,          false, '{grams}', 3),
  ('lb',     'pound',                'mass', 0.45359237,     false, '{lbs,pounds}', 4),
  ('ton_us', 'short ton (US)',       'mass', 907.18474,      false, '{short ton}', 5),
  -- volume (base litre)
  ('L',      'litre',                'volume', 1,            true,  '{litres,liter,liters,l,ltr}', 10),
  ('kL',     'kilolitre',            'volume', 1000,         false, '{kilolitres,kl}', 11),
  ('m3',     'cubic metre',          'volume', 1000,         false, '{cubic metres,m³,cbm}', 12),
  ('gal_us', 'US gallon',            'volume', 3.785411784,  false, '{gallon,gallons,gal}', 13),
  ('gal_uk', 'imperial gallon',      'volume', 4.54609,      false, '{imperial gallons}', 14),
  ('bbl',    'barrel (oil)',         'volume', 158.987294928,false, '{barrel,barrels}', 15),
  ('scf',    'standard cubic foot',  'volume', 28.316846592, false, '{cubic feet,ft3}', 16),
  -- energy, net calorific value (base kWh net)
  ('kWh',    'kWh (net CV)',         'energy_net', 1,              true,  '{kWh (Net CV)}', 20),
  ('MWh',    'MWh (net CV)',         'energy_net', 1000,           false, '{}', 21),
  ('MJ',     'MJ (net CV)',          'energy_net', 0.277777777778, false, '{}', 22),
  ('GJ',     'GJ (net CV)',          'energy_net', 277.777777778,  false, '{}', 23),
  ('TJ',     'TJ (net CV)',          'energy_net', 277777.777778,  false, '{}', 24),
  -- energy, gross calorific value (base kWh gross) — UK and Gulf gas bills are gross
  ('kWh_gcv',  'kWh (gross CV)',     'energy_gross', 1,              true,  '{kWh (Gross CV)}', 30),
  ('MWh_gcv',  'MWh (gross CV)',     'energy_gross', 1000,           false, '{}', 31),
  ('GJ_gcv',   'GJ (gross CV)',      'energy_gross', 277.777777778,  false, '{}', 32),
  ('therm',    'therm (gross CV)',   'energy_gross', 29.3071070172,  false, '{therms}', 33),
  ('MMBtu',    'MMBtu (gross CV)',   'energy_gross', 293.071070172,  false, '{mmbtu}', 34);

-- Scope 1 categories. calc_method tells the engine which formula applies.
INSERT INTO category (scope, code, name, calc_method, description, sort) VALUES
  (1, 'stationary_combustion', 'Stationary combustion', 'combustion',
      'Fuels burned in boilers, furnaces, generators, ovens and other fixed equipment.', 10),
  (1, 'fugitive', 'Fugitive emissions', 'fugitive',
      'Gases leaking or released from equipment: refrigerants and air-conditioning, fire suppression, SF6 switchgear, methane leaks.', 30);

-- Stationary combustion subcategories (the six fuel classes).
INSERT INTO subcategory (category_id, code, name, units, default_unit, is_bioenergy, sort)
SELECT c.id, v.code, v.name, v.units, v.default_unit, v.bio, v.sort
FROM category c, (VALUES
  ('liquid_fuels',  'Liquid fuels',  '{L,kL,gal_us,gal_uk,bbl,kg,t,kWh,MWh,GJ,kWh_gcv,MWh_gcv,GJ_gcv}'::text[], 'L',   false, 1),
  ('solid_fuels',   'Solid fuels',   '{kg,t,lb,kWh,MWh,GJ,kWh_gcv,GJ_gcv}'::text[],                            't',   false, 2),
  ('gaseous_fuels', 'Gaseous fuels', '{m3,scf,L,kg,t,kWh,MWh,GJ,kWh_gcv,MWh_gcv,GJ_gcv,therm,MMBtu}'::text[],  'm3',  false, 3),
  ('biofuel',       'Biofuel',       '{L,kL,gal_us,kg,t,GJ,kWh,MWh}'::text[],                                  'L',   true,  4),
  ('biomass',       'Biomass',       '{kg,t,kWh,MWh,GJ}'::text[],                                              't',   true,  5),
  ('biogas',        'Biogas',        '{kg,t,kWh,MWh,GJ}'::text[],                                              'kWh', true,  6)
) AS v(code, name, units, default_unit, bio, sort)
WHERE c.code = 'stationary_combustion';

-- Fugitive subcategories, grouped by what the user is looking at, not by chemistry.
INSERT INTO subcategory (category_id, code, name, units, default_unit, sort)
SELECT c.id, v.code, v.name, '{kg,g,lb,t}'::text[], 'kg', v.sort
FROM category c, (VALUES
  ('refrigerant_blends',  'Refrigerant blends (R-4xx, R-5xx)', 1),
  ('hfc_pfc',             'HFCs and PFCs (single gases)', 2),
  ('sf6_nf3',             'SF6 and NF3 (switchgear, electronics)', 3),
  ('ozone_depleting',     'Ozone-depleting gases (CFCs, HCFCs, halons) — reported separately', 4),
  ('other_gases',         'Other gases (CO2 extinguishers, methane, N2O, hydrocarbons, HFOs)', 5)
) AS v(code, name, sort)
WHERE c.code = 'fugitive';

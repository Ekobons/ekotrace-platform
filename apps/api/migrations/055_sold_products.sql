-- Scope 3 categories 10, 11 and 12: what happens to the company's products after the sale.
--
--   3.10 Processing of sold products — intermediate products processed further by others (e.g. resin moulded into parts)
--   3.11 Use of sold products        — energy, fuel and gases released while customers use the products, over their life
--   3.12 End-of-life treatment       — disposal of the products (and their packaging) at the end of their life
--
-- All three use the calculation method 'asset' (see 054): everything is counted in the category's Scope 3.
--   * energy or fuel known → the platform's grid and fuel factors (attrs.via), with grid losses and upstream;
--   * refrigerant / gas leaked by products in use → the gas's GWP (attrs.via to a fugitive item, mass released);
--   * waste by material and route → the DESNZ waste factors of the "Waste sent to others" items (attrs.via);
--   * emissions reported by a processor or from a product study (LCA, EPD), in kg or t CO2e.
-- The old Ekotrace screens had the same three tabs: processing (site-specific Scope 1+2 or an average
-- factor per industry), use (product energy type, units sold, lifetime, electricity / fuel / refrigerant
-- per use) and end of life (waste type, tonnes, share to landfill, incineration, recycling, composting).
SELECT set_config('app.platform', 'on', true);

INSERT INTO category (scope, code, name, calc_method, description, sort, ghg_category) VALUES
  (3, 'processing_sold', 'Processing of sold products (Scope 3.10)', 'asset',
   'Intermediate products the company sells that others process further before they reach the end user — e.g. resin moulded into parts, steel coil pressed into panels, grain milled into flour. By the energy the processor uses for your products, or the processor''s reported emissions.', 72, 10),
  (3, 'use_sold', 'Use of sold products (Scope 3.11)', 'asset',
   'Emissions while customers use the products sold in the year, over their whole expected life: electricity of appliances and electronics, fuel burned by engines and vehicles, fuels sold to customers, refrigerant leaking from equipment. Enter the lifetime total (units sold × years of life × use per year).', 73, 11),
  (3, 'eol_sold', 'End-of-life treatment of sold products (Scope 3.12)', 'asset',
   'Disposal of the products sold in the year — and their packaging — when customers throw them away: tonnes by material and by route (landfill, incineration, recycling, composting), with the DESNZ waste factors.', 74, 12)
ON CONFLICT (code) DO NOTHING;

INSERT INTO subcategory (category_id, code, name, units, default_unit, sort)
SELECT c.id, v.code, v.name, v.units::text[], v.def, v.sort
FROM category c JOIN (VALUES
  ('processing_sold', 'p10_energy',      'Energy used by the processor',                  '{}',              NULL,     1),
  ('processing_sold', 'p10_reported',    'Emissions reported by the processor',           '{kgco2e,tco2e}',  'kgco2e', 2),
  ('use_sold',        'u11_electricity', 'Products that use electricity',                 '{}',              NULL,     1),
  ('use_sold',        'u11_fuel',        'Products that burn fuel',                       '{}',              NULL,     2),
  ('use_sold',        'u11_fuels_sold',  'Fuels sold to customers',                       '{}',              NULL,     3),
  ('use_sold',        'u11_gas',         'Refrigerants and gases released by products',   '{kg,t,lb}',       'kg',     4),
  ('use_sold',        'u11_reported',    'Use-phase emissions from a product study',      '{kgco2e,tco2e}',  'kgco2e', 5),
  ('eol_sold',        'e12_reported',    'Emissions from a product study',                '{kgco2e,tco2e}',  'kgco2e', 99)
) AS v(cat, code, name, units, def, sort) ON v.cat = c.code
ON CONFLICT (category_id, code) DO NOTHING;

-- 3.10: the processor's energy for your products (their meters, or energy per tonne × tonnes sold).
INSERT INTO item (subcategory_id, code, name, default_unit, note, sort, attrs)
SELECT s.id, s.code || ':' || v.k, v.name, v.unit, v.note, v.sort, jsonb_build_object('via', v.via)
FROM subcategory s JOIN (VALUES
  ('electricity', 'Electricity',  'grid:electricity',                 'kWh_e', 'Grid factor of the facility''s grid region, with grid losses and upstream.', 1),
  ('natural-gas', 'Natural gas',  'desnz:natural-gas',                'm3',    'DESNZ natural gas, with upstream (well-to-tank).', 2),
  ('diesel',      'Diesel',       'desnz:diesel-100-mineral-diesel',  'L',     'DESNZ diesel (100% mineral), with upstream.', 3),
  ('fuel-oil',    'Fuel oil',     'desnz:fuel-oil',                   'L',     'DESNZ fuel oil, with upstream.', 4),
  ('lpg',         'LPG',          'desnz:lpg',                        'kg',    'DESNZ LPG, with upstream.', 5)
) AS v(k, name, via, unit, note, sort) ON TRUE
WHERE s.code = 'p10_energy'
ON CONFLICT (code) DO NOTHING;

-- 3.11 direct use phase: lifetime electricity and fuel of the products sold in the year.
INSERT INTO item (subcategory_id, code, name, default_unit, note, sort, attrs)
SELECT s.id, s.code || ':electricity', 'Electricity over the products'' life', 'kWh_e',
  'Units sold × years of life × kWh per year. Grid factor of the facility''s grid region (where the products are mainly used is better: choose that facility), with grid losses and upstream.', 1,
  '{"via": "grid:electricity"}'::jsonb
FROM subcategory s WHERE s.code = 'u11_electricity'
ON CONFLICT (code) DO NOTHING;

INSERT INTO item (subcategory_id, code, name, default_unit, note, sort, attrs)
SELECT s.id, s.code || ':' || v.k, v.name, v.unit, n.note, v.sort, jsonb_build_object('via', v.via)
FROM subcategory s JOIN (VALUES
  ('diesel',      'Diesel',          'desnz:diesel-100-mineral-diesel', 'L',  1),
  ('petrol',      'Petrol',          'desnz:petrol-100-mineral-petrol', 'L',  2),
  ('natural-gas', 'Natural gas',     'desnz:natural-gas',               'm3', 3),
  ('lpg',         'LPG',             'desnz:lpg',                       'kg', 4),
  ('kerosene',    'Kerosene (burning oil)', 'desnz:burning-oil',        'L',  5)
) AS v(k, name, via, unit, sort) ON TRUE
CROSS JOIN LATERAL (SELECT CASE WHEN s.code = 'u11_fuel'
  THEN 'Fuel burned by the products over their life: units sold × years × fuel per year. DESNZ factor, with upstream.'
  ELSE 'Fuel sold to customers and burned by them (fuel retailers, gas suppliers). DESNZ factor, with upstream.' END AS note) n
WHERE s.code IN ('u11_fuel', 'u11_fuels_sold')
ON CONFLICT (code) DO NOTHING;

-- Fuels sold also include aviation and marine fuels and coal.
INSERT INTO item (subcategory_id, code, name, default_unit, note, sort, attrs)
SELECT s.id, s.code || ':' || v.k, v.name, v.unit, 'Fuel sold to customers and burned by them. DESNZ factor, with upstream.', v.sort, jsonb_build_object('via', v.via)
FROM subcategory s JOIN (VALUES
  ('jet',         'Aviation turbine fuel (jet fuel)', 'desnz:aviation-turbine-fuel', 'L',  6),
  ('marine',      'Marine gas oil',                   'desnz:marine-gas-oil',        'L',  7),
  ('fuel-oil',    'Fuel oil',                         'desnz:fuel-oil',              'L',  8),
  ('coal',        'Coal (industrial)',                'desnz:coal-industrial',       't',  9)
) AS v(k, name, via, unit, sort) ON TRUE
WHERE s.code = 'u11_fuels_sold'
ON CONFLICT (code) DO NOTHING;

-- 3.11 gases: mass released over the products' life (charge × leak rate × years, plus what escapes at disposal).
INSERT INTO item (subcategory_id, code, name, default_unit, note, sort, attrs)
SELECT s.id, 'u11_gas:' || v.k, v.name, 'kg',
  'Mass released over the life of the units sold: units × charge × annual leak rate × years (+ the charge not recovered at disposal). × the gas''s GWP.', v.sort, jsonb_build_object('via', v.via)
FROM subcategory s JOIN (VALUES
  ('r410a',  'R-410A (air conditioners)',              'blend:r410a',   1),
  ('r32',    'R-32 / HFC-32 (air conditioners)',       'gas:hfc-32',    2),
  ('r134a',  'R-134a (refrigerators, vehicle AC)',     'gas:hfc-134a',  3),
  ('r404a',  'R-404A (commercial refrigeration)',      'blend:r404a',   4),
  ('r407c',  'R-407C',                                 'blend:r407c',   5),
  ('r1234yf','R-1234yf (vehicle AC)',                  'gas:hfo-1234yf',6),
  ('r290',   'R-290 propane',                          'gas:r290',      7),
  ('r600a',  'R-600a isobutane (domestic fridges)',    'gas:r600a',     8),
  ('co2',    'CO₂ (R-744, fire extinguishers, soda)',  'gas:co2',       9)
) AS v(k, name, via, sort) ON TRUE
WHERE s.code = 'u11_gas'
ON CONFLICT (code) DO NOTHING;

-- Reported / study figures.
INSERT INTO item (subcategory_id, code, name, default_unit, note, sort, attrs)
SELECT s.id, s.code || ':reported', 'Emissions reported', 'kgco2e', v.note, 1, '{"reported": true}'::jsonb
FROM subcategory s JOIN (VALUES
  ('p10_reported', 'The processor''s Scope 1 and 2 for processing your products, as they report it (or their emissions per tonne × the tonnes you sold them). Attach their statement as evidence.'),
  ('u11_reported', 'Lifetime use-phase emissions of the units sold, from a product carbon footprint, LCA or EPD of the product (per unit × units sold). Attach the study as evidence.'),
  ('e12_reported', 'End-of-life emissions of the units sold, from a product carbon footprint, LCA or EPD (per unit × units sold). Attach the study as evidence.')
) AS v(code, note) ON v.code = s.code
ON CONFLICT (code) DO NOTHING;

-- 3.12: one subcategory per material, the same materials and routes as "Waste sent to others" (DESNZ waste factors).
INSERT INTO subcategory (category_id, code, name, units, default_unit, sort)
SELECT c.id, 'e12_' || substr(w.code, 8), w.name, w.units, w.default_unit, w.sort
FROM category c, subcategory w JOIN category wc ON wc.id = w.category_id
WHERE c.code = 'eol_sold' AND wc.code = 'waste_generated' AND w.code LIKE 'waste3\_%' AND w.code <> 'waste3_hazardous'
ON CONFLICT (category_id, code) DO NOTHING;

INSERT INTO item (subcategory_id, code, name, default_unit, note, sort, attrs)
SELECT e.id, 'eol12:' || substr(i.code, 8), i.name, i.default_unit,
  'Tonnes of the products (or packaging) of this material that end up by this route. DESNZ waste factor, as in Waste sent to others.', i.sort,
  jsonb_build_object('via', i.code)
FROM item i JOIN subcategory w ON w.id = i.subcategory_id
JOIN subcategory e ON e.code = 'e12_' || substr(w.code, 8)
JOIN category ec ON ec.id = e.category_id AND ec.code = 'eol_sold'
WHERE w.code LIKE 'waste3\_%' AND i.active
ON CONFLICT (code) DO NOTHING;

-- Tabs in GHG Protocol order: 3.9, 3.10, 3.11, 3.12, then 3.13.
UPDATE category SET sort = 75 WHERE code = 'downstream_leased';

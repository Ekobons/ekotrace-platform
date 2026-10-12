-- Water: what a facility takes in (by source), reuses, and lets out (by destination), in m³.
--
-- Emissions (Scope 3): water bought from a utility or tanker is a purchased good (3.1); water sent
-- to a public sewer or removed by tanker for treatment is waste treated by others (3.5). Water from
-- the company's own wells, sea intake or rain has no Scope 3 emissions (pumping and desalination
-- energy are already in the company's own fuel and electricity). Factors: DESNZ "Water supply" and
-- "Water treatment", or the utility's own factor per m³ entered on the entry.
--
-- Accounting (GRI 303): withdrawal by source (surface, groundwater, seawater, third-party),
-- discharge by destination, consumption = withdrawal − discharge, water recycled or reused.
SELECT set_config('app.platform', 'on', true);

ALTER TABLE category DROP CONSTRAINT IF EXISTS category_calc_method_check;
ALTER TABLE category ADD CONSTRAINT category_calc_method_check
  CHECK (calc_method IN ('combustion','fugitive','vehicle','electricity','waste','waste_disposal','spend','travel','water'));

INSERT INTO unit (code, name, dimension, to_base, is_base, aliases, sort) VALUES
  ('ML', 'megalitre', 'volume', 1000000, false, '{megalitre,megalitres,million litres}', 22),
  ('kgal_uk', 'thousand imperial gallons', 'volume', 4546.09, false, '{TIG,000 IG,thousand IG,1000 IG}', 34)
ON CONFLICT (code) DO NOTHING;
UPDATE unit SET aliases = (SELECT array_agg(DISTINCT a) FROM unnest(aliases || '{IG,imp gal,imperial gallons,gallons (imperial)}'::text[]) a) WHERE code = 'gal_uk';

INSERT INTO category (scope, code, name, calc_method, description, sort, ghg_category) VALUES
  (3, 'water_supply', 'Water withdrawn', 'water',
   'Water the facility takes in, by source (utility, tanker, treated wastewater bought, own wells, sea, rain), and water recycled on site. Water bought counts in Scope 3.1.', 68, 1),
  (3, 'water_discharge', 'Water discharged', 'water',
   'Water the facility lets out, by destination (public sewer, tanker for treatment, irrigation or soak-away, sea, surface water). Water treated by others counts in Scope 3.5.', 69, 5)
ON CONFLICT (code) DO NOTHING;

INSERT INTO subcategory (category_id, code, name, units, default_unit, sort)
SELECT c.id, v.code, v.name, '{m3,kL,L,ML,gal_uk,kgal_uk}'::text[], 'm3', v.sort
FROM category c JOIN (VALUES
  ('water_supply', 'water_in', 'Withdrawn (by source)', 1),
  ('water_supply', 'water_reuse', 'Recycled or reused on site', 2),
  ('water_discharge', 'water_out', 'Discharged (by destination)', 1)
) AS v(cat, code, name, sort) ON v.cat = c.code
ON CONFLICT (category_id, code) DO NOTHING;

-- attrs: flow (withdrawal | reuse | discharge), gri (third_party | groundwater | seawater | surface), factor (supply | treatment | none)
INSERT INTO item (subcategory_id, code, name, default_unit, note, sort, attrs)
SELECT s.id, v.code, v.name, 'm3', v.note, v.sort, v.attrs::jsonb
FROM subcategory s JOIN (VALUES
  ('water_in', 'water:mains_desal', 'Mains water — desalinated', 'From the utility (DEWA, SEWA, Etihad WE, TAQA…). Default factor: DESNZ water supply (UK); desalinated water uses more energy: enter the utility''s factor when known.', 1, '{"flow":"withdrawal","gri":"third_party","factor":"supply","desal":true}'),
  ('water_in', 'water:mains', 'Mains water — other', 'Utility water not from desalination.', 2, '{"flow":"withdrawal","gri":"third_party","factor":"supply"}'),
  ('water_in', 'water:tanker', 'Tanker water', 'Water delivered by tanker.', 3, '{"flow":"withdrawal","gri":"third_party","factor":"supply"}'),
  ('water_in', 'water:tse', 'Treated wastewater (TSE) bought', 'Treated sewage effluent bought for irrigation or cooling. Default factor: DESNZ water supply.', 4, '{"flow":"withdrawal","gri":"third_party","factor":"supply"}'),
  ('water_in', 'water:groundwater', 'Groundwater (own well)', 'No Scope 3 emissions: pumping energy is in your own electricity or fuel.', 5, '{"flow":"withdrawal","gri":"groundwater","factor":"none"}'),
  ('water_in', 'water:seawater', 'Seawater (own intake or desalination)', 'No Scope 3 emissions: desalination energy is in your own electricity or fuel.', 6, '{"flow":"withdrawal","gri":"seawater","factor":"none"}'),
  ('water_in', 'water:surface', 'Rainwater or surface water', 'Collected rainwater, rivers, lakes.', 7, '{"flow":"withdrawal","gri":"surface","factor":"none"}'),
  ('water_reuse', 'water:reuse', 'Recycled or reused on site', 'Water treated or reused at the facility (e.g. greywater, own TSE for irrigation). Not a withdrawal; no emissions.', 1, '{"flow":"reuse","factor":"none"}'),
  ('water_out', 'water:sewer', 'To public sewer / municipal treatment', 'Default factor: DESNZ water treatment.', 1, '{"flow":"discharge","gri":"third_party","factor":"treatment"}'),
  ('water_out', 'water:tanker_out', 'Removed by tanker for treatment', 'Wastewater collected by tanker to a treatment plant. Default factor: DESNZ water treatment.', 2, '{"flow":"discharge","gri":"third_party","factor":"treatment"}'),
  ('water_out', 'water:irrigation', 'Irrigation or soak-away', 'Released to land (groundwater). No Scope 3 emissions.', 3, '{"flow":"discharge","gri":"groundwater","factor":"none"}'),
  ('water_out', 'water:sea', 'To sea', 'E.g. brine or cooling water returned to the sea. No Scope 3 emissions.', 4, '{"flow":"discharge","gri":"seawater","factor":"none"}'),
  ('water_out', 'water:surface_out', 'To surface water', 'Rivers, lakes, wadis. No Scope 3 emissions.', 5, '{"flow":"discharge","gri":"surface","factor":"none"}')
) AS v(sub, code, name, note, sort, attrs) ON v.sub = s.code
JOIN category c ON c.id = s.category_id AND c.code IN ('water_supply', 'water_discharge')
ON CONFLICT (code) DO NOTHING;

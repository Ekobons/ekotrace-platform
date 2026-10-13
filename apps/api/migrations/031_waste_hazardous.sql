-- Waste sent out (Scope 3.5): hazardous streams and defaults.
--
-- 1. Materials that are usually hazardous get attrs.hazardous = true: the screen fills it in, the person can change it
--    (the manifest decides). The importer sets the same flag on new databases.
-- 2. Hazardous streams DESNZ has no factor for, with routes incineration, landfill and "treatment" (other disposal,
--    GRI 306-5). Each points to the nearest DESNZ factor (attrs.proxy); entries say a proxy was used.
SELECT set_config('app.platform', 'on', true);

UPDATE item SET attrs = attrs || '{"hazardous": true}'::jsonb
 WHERE code LIKE 'waste3:%' AND attrs->>'material' IN ('Asbestos', 'Batteries', 'WEEE - fridges and freezers', 'Mineral oil');

INSERT INTO subcategory (category_id, code, name, units, default_unit, sort)
SELECT c.id, 'waste3_hazardous', 'Hazardous waste (no DESNZ factor)', '{t,kg}', 't', 8 FROM category c WHERE c.code = 'waste_generated'
ON CONFLICT (category_id, code) DO NOTHING;

INSERT INTO item (subcategory_id, code, name, default_unit, sort, note, attrs)
SELECT s.id, 'waste3:hazardous:' || v.slug || ':' || v.route,
       v.material || ' · ' || CASE v.route WHEN 'combustion' THEN 'Incineration' WHEN 'landfill' THEN 'Landfill' WHEN 'closed_loop' THEN 'Recycling / re-refining' ELSE 'Treatment (other disposal)' END,
       't', CASE v.route WHEN 'closed_loop' THEN 1 WHEN 'combustion' THEN 4 WHEN 'treatment' THEN 6 ELSE 7 END,
       'No DESNZ factor: the nearest DESNZ factor is used as a proxy (' || v.proxy || ').',
       jsonb_build_object('material', v.material, 'route', v.route, 'hazardous', true, 'proxy', v.proxy)
FROM subcategory s, (VALUES
  ('clinical',  'Clinical / healthcare waste',               'combustion',  'waste3:refuse:commercial-and-industrial-waste:combustion'),
  ('clinical',  'Clinical / healthcare waste',               'treatment',   'waste3:refuse:commercial-and-industrial-waste:combustion'),
  ('clinical',  'Clinical / healthcare waste',               'landfill',    'waste3:refuse:commercial-and-industrial-waste:landfill'),
  ('chemical',  'Chemical and solvent waste',                'combustion',  'waste3:construction:mineral-oil:combustion'),
  ('chemical',  'Chemical and solvent waste',                'treatment',   'waste3:construction:mineral-oil:combustion'),
  ('oily',      'Oily waste and sludge',                     'combustion',  'waste3:construction:mineral-oil:combustion'),
  ('oily',      'Oily waste and sludge',                     'closed_loop', 'waste3:construction:mineral-oil:closed_loop'),
  ('oily',      'Oily waste and sludge',                     'treatment',   'waste3:construction:mineral-oil:combustion'),
  ('paints',    'Paints, inks and adhesives',                'combustion',  'waste3:refuse:commercial-and-industrial-waste:combustion'),
  ('paints',    'Paints, inks and adhesives',                'landfill',    'waste3:refuse:commercial-and-industrial-waste:landfill'),
  ('packaging', 'Contaminated packaging and absorbents',     'combustion',  'waste3:plastic:plastics-average-plastics:combustion'),
  ('packaging', 'Contaminated packaging and absorbents',     'landfill',    'waste3:plastic:plastics-average-plastics:landfill'),
  ('other',     'Other hazardous waste',                     'combustion',  'waste3:refuse:commercial-and-industrial-waste:combustion'),
  ('other',     'Other hazardous waste',                     'treatment',   'waste3:refuse:commercial-and-industrial-waste:combustion'),
  ('other',     'Other hazardous waste',                     'landfill',    'waste3:refuse:commercial-and-industrial-waste:landfill')
) AS v(slug, material, route, proxy)
WHERE s.code = 'waste3_hazardous'
ON CONFLICT (code) DO NOTHING;

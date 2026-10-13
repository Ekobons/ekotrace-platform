-- Meetings and events as their own kind of hotel entry: meeting space by hotel type (2- to 5-star),
-- with the factor for any hotel type as the fallback. Factors (CHSB / HCMI, per m² per hour) are
-- added in the factor library by country or for all countries.
SELECT set_config('app.platform', 'on', true);

UPDATE item SET name = 'Meeting space · any hotel type' WHERE code = 'bt:meeting:space';

INSERT INTO item (subcategory_id, code, name, default_unit, sort, note, attrs)
SELECT s.id, v.code, v.name, 'sqm_hour', v.sort, 'Per m² of meeting / event space per hour. CHSB / HCMI meeting-space footprint; by country, or GLOBAL.', v.attrs::jsonb
FROM subcategory s, (VALUES
  ('bt:meeting:space:2', 'Meeting space · 2-star hotel', 2, '{"stars":2}'),
  ('bt:meeting:space:3', 'Meeting space · 3-star hotel', 3, '{"stars":3}'),
  ('bt:meeting:space:4', 'Meeting space · 4-star hotel', 4, '{"stars":4}'),
  ('bt:meeting:space:5', 'Meeting space · 5-star hotel', 5, '{"stars":5}')
) AS v(code, name, sort, attrs)
WHERE s.code = 'bt_meeting'
ON CONFLICT (code) DO NOTHING;

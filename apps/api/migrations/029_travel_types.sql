-- Business travel, flight types and hotel classes.
--
-- Flights are named by type: Domestic, Short-haul (under 3,700 km), Long-haul (3,700 km or more) and
-- International (average, when not known). DESNZ publishes its short- and long-haul factors for flights
-- to/from the UK; they are used for any flight by its distance, the international average when the
-- type is not known.
--
-- Hotel stays by star rating and meeting / event space: catalogue items in the factor library. Their
-- factors come from the Cornell Hotel Sustainability Benchmarking (CHSB) index / HCMI and are added in
-- the library (by country, or GLOBAL) once the data set is licensed. Until then a stay uses the DESNZ
-- country average and meeting space is not counted (the entry says so).
SELECT set_config('app.platform', 'on', true);

UPDATE item SET name = regexp_replace(name, 'Flight · (domestic|short-haul, to/from UK|long-haul, to/from UK|international) · ',
         'Flight · ' || CASE attrs->>'haul' WHEN 'domestic' THEN 'Domestic' WHEN 'short' THEN 'Short-haul (under 3,700 km)'
                                          WHEN 'long' THEN 'Long-haul (3,700 km or more)' ELSE 'International (average)' END || ' · '),
       note = CASE attrs->>'haul'
         WHEN 'domestic' THEN 'Flights within one country. DESNZ domestic factor. Per passenger-km.'
         WHEN 'short' THEN 'Flights under 3,700 km between two countries. DESNZ short-haul factor (published for flights to/from the UK). Per passenger-km.'
         WHEN 'long' THEN 'Flights of 3,700 km or more between two countries. DESNZ long-haul factor (published for flights to/from the UK). Per passenger-km.'
         ELSE 'Average of international flights, when the distance is not known (DESNZ "International, to/from non-UK"). Per passenger-km.' END,
       sort = (CASE attrs->>'haul' WHEN 'domestic' THEN 0 WHEN 'short' THEN 1 WHEN 'long' THEN 2 ELSE 3 END) * 10
            + (CASE attrs->>'cls' WHEN 'economy' THEN 0 WHEN 'premium' THEN 1 WHEN 'business' THEN 2 WHEN 'first' THEN 3 ELSE 4 END)
            + (CASE WHEN (attrs->>'rf')::boolean THEN 0 ELSE 100 END)
 WHERE code LIKE 'bt:air:%';

INSERT INTO unit (code, name, dimension, to_base, is_base, aliases, sort) VALUES
  ('sqm_hour', 'm²-hour', 'meeting_space', 1, true, '{m2 hour,sqm hour,square metre hour}', 93)
ON CONFLICT (code) DO NOTHING;

INSERT INTO subcategory (category_id, code, name, units, default_unit, sort)
SELECT c.id, v.code, v.name, v.units::text[], v.def, v.sort
FROM category c, (VALUES
  ('bt_hotel_class', 'Hotel stays by star rating', '{room_night}', 'room_night', 8),
  ('bt_meeting',     'Meeting and event space',    '{sqm_hour}',   'sqm_hour',   9)
) AS v(code, name, units, def, sort)
WHERE c.code = 'business_travel'
ON CONFLICT (category_id, code) DO NOTHING;

INSERT INTO item (subcategory_id, code, name, default_unit, sort, note, attrs)
SELECT s.id, v.code, v.name, v.unit, v.sort, v.note, v.attrs::jsonb
FROM subcategory s, (VALUES
  ('bt_hotel_class', 'bt:hotel:class:2', 'Hotel · 2-star (economy)',            'room_night', 2, 'Per occupied room-night. CHSB / HCMI economy segment; by country, or GLOBAL.', '{"stars":2}'),
  ('bt_hotel_class', 'bt:hotel:class:3', 'Hotel · 3-star (midscale)',           'room_night', 3, 'Per occupied room-night. CHSB / HCMI midscale segment; by country, or GLOBAL.', '{"stars":3}'),
  ('bt_hotel_class', 'bt:hotel:class:4', 'Hotel · 4-star (upscale)',            'room_night', 4, 'Per occupied room-night. CHSB / HCMI upscale segment; by country, or GLOBAL.', '{"stars":4}'),
  ('bt_hotel_class', 'bt:hotel:class:5', 'Hotel · 5-star (luxury)',             'room_night', 5, 'Per occupied room-night. CHSB / HCMI luxury segment; by country, or GLOBAL.', '{"stars":5}'),
  ('bt_meeting',     'bt:meeting:space', 'Meeting and event space in a hotel',  'sqm_hour',   1, 'Per m² of meeting space per hour. CHSB / HCMI meeting-space footprint; by country, or GLOBAL.', '{}')
) AS v(sub, code, name, unit, sort, note, attrs)
WHERE s.code = v.sub
ON CONFLICT (code) DO NOTHING;

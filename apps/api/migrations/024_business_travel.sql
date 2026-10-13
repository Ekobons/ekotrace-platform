-- Business travel (Scope 3.6): flights, hotel stays and other transport, or spend.
--
-- Flights by passenger-km: from / to airports (great-circle distance + 8%, as DESNZ advises) or a
-- flight type with a distance; class; return; trips. DESNZ "Business travel- air" factors, with
-- radiative forcing (RF) unless the company chooses without. Hotel stays per room-night by country
-- (DESNZ "Hotel stay"). Rail, bus, taxi, car hire and ferry per passenger-km or km (DESNZ land and
-- sea). Well-to-tank counted in 3.6. Spend (air fares, hotels, taxis…) stays with the EPA spend
-- factors, through Purchases or typed in.
SELECT set_config('app.platform', 'on', true);

ALTER TABLE category DROP CONSTRAINT IF EXISTS category_calc_method_check;
ALTER TABLE category ADD CONSTRAINT category_calc_method_check
  CHECK (calc_method IN ('combustion','fugitive','vehicle','electricity','waste','waste_disposal','spend','travel','water','trip'));
UPDATE category SET calc_method = 'trip', name = 'Business travel',
       description = 'Flights, hotel stays, trains, taxis, car hire and other travel for work, in vehicles the company does not own: by distance and nights, or by spend.'
 WHERE code = 'business_travel';

INSERT INTO unit (code, name, dimension, to_base, is_base, aliases, sort) VALUES
  ('room_night', 'room-night', 'accommodation', 1, true, '{Room per night,room night,room nights,room-nights}', 92)
ON CONFLICT (code) DO NOTHING;

INSERT INTO subcategory (category_id, code, name, units, default_unit, sort)
SELECT c.id, v.code, v.name, v.units::text[], v.def, v.sort
FROM category c, (VALUES
  ('bt_air',   'Flights',                 '{pkm}',        'pkm',        1),
  ('bt_hotel', 'Hotel stays',             '{room_night}', 'room_night', 2),
  ('bt_rail',  'Rail, metro and tram',    '{pkm}',        'pkm',        3),
  ('bt_bus',   'Bus and coach',           '{pkm}',        'pkm',        4),
  ('bt_taxi',  'Taxi and ride-hailing',   '{pkm}',        'pkm',        5),
  ('bt_car',   'Car hire and own car',    '{km}',         'km',         6),
  ('bt_sea',   'Ferry',                   '{pkm}',        'pkm',        7)
) AS v(code, name, units, def, sort)
WHERE c.code = 'business_travel'
ON CONFLICT (category_id, code) DO NOTHING;

-- The company's choice for flights: with radiative forcing (DESNZ's recommendation) or without.
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS flight_rf boolean NOT NULL DEFAULT true;

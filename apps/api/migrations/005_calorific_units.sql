-- Energy units for entering a calorific value (energy per kg / litre / m3…).
-- MJ (net) and GJ, kWh, MMBtu, therm already exist.
INSERT INTO unit (code, name, dimension, to_base, is_base, aliases, sort) VALUES
  ('MJ_gcv',  'MJ (gross CV)',  'energy_gross', 0.277777777778, false, '{MJ gross,MJ GCV,MJ HHV}', 41),
  ('Btu_gcv', 'Btu (gross CV)', 'energy_gross', 0.000293071070172, false, '{Btu,BTU,Btu HHV}', 46)
ON CONFLICT (code) DO NOTHING;

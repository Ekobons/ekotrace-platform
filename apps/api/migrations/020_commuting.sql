-- Employee commuting (Scope 3 category 7).
--
-- Entered once a year per facility, either typed in (employees per mode, average one-way
-- distance, days at the workplace per week) or from a commuting survey whose answers are
-- scaled up to the facility's headcount. The year's distances become one entry per mode and
-- month (split by the working days of each month), so dashboards and reports read them like
-- any other entry; they are changed only through the commuting record.
--
-- Factors: DESNZ "Business travel- land" (per vehicle-km for cars and motorbikes, per
-- passenger-km for taxis, buses and rail) with their well-to-tank, both counted in 3.7.
SELECT set_config('app.platform', 'on', true);

ALTER TABLE category DROP CONSTRAINT IF EXISTS category_calc_method_check;
ALTER TABLE category ADD CONSTRAINT category_calc_method_check
  CHECK (calc_method IN ('combustion','fugitive','vehicle','electricity','waste','waste_disposal','spend','travel'));

INSERT INTO unit (code, name, dimension, to_base, is_base, aliases, sort) VALUES
  ('pkm', 'passenger-km', 'passenger_distance', 1, true, '{passenger.km,passenger km,pkm,p-km}', 90)
ON CONFLICT (code) DO NOTHING;

INSERT INTO category (scope, code, name, calc_method, description, sort, ghg_category) VALUES
  (3, 'employee_commuting', 'Employee commuting', 'travel',
   'Travel between home and the workplace by employees, in vehicles the company does not own or control. Entered once a year per facility: typed in, or from a commuting survey scaled up to all employees.', 66, 7)
ON CONFLICT (code) DO NOTHING;

INSERT INTO subcategory (category_id, code, name, units, default_unit, sort)
SELECT c.id, v.code, v.name, v.units::text[], v.def, v.sort
FROM category c, (VALUES
  ('commute_car',       'Car',                       '{km}',  'km',  1),
  ('commute_motorbike', 'Motorbike',                 '{km}',  'km',  2),
  ('commute_taxi',      'Taxi / ride-hailing',       '{pkm}', 'pkm', 3),
  ('commute_bus',       'Bus / staff shuttle',       '{pkm}', 'pkm', 4),
  ('commute_rail',      'Metro, tram and train',     '{pkm}', 'pkm', 5),
  ('commute_active',    'Walking and cycling',       '{km}',  'km',  6)
) AS v(code, name, units, def, sort)
WHERE c.code = 'employee_commuting'
ON CONFLICT (category_id, code) DO NOTHING;

-- Walking, cycling (also e-scooters): counted in the distances, no emissions.
INSERT INTO item (subcategory_id, code, name, default_unit, note, sort)
SELECT s.id, 'commute:active', 'Walking, cycling, e-scooter', 'km', 'No emissions; kept so the survey adds up.', 1
FROM subcategory s JOIN category c ON c.id = s.category_id AND c.code = 'employee_commuting' WHERE s.code = 'commute_active'
ON CONFLICT (code) DO NOTHING;

-- One commuting record per facility and year.
CREATE TABLE IF NOT EXISTS commute_record (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  facility_id   uuid NOT NULL REFERENCES org_node(id),
  year          int  NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  method        text NOT NULL CHECK (method IN ('typed','survey')),
  headcount     int  NOT NULL CHECK (headcount >= 0),
  working_days  numeric(6,1) NOT NULL CHECK (working_days > 0 AND working_days <= 366),
  weekend       text NOT NULL DEFAULT 'sat_sun' CHECK (weekend IN ('sat_sun','fri_sat','sun')),
  rows          jsonb NOT NULL DEFAULT '[]',   -- typed: one row per mode
  survey        jsonb,                         -- survey: file, columns, respondents, response rate
  result        jsonb NOT NULL DEFAULT '{}',   -- distances per mode and the year's tCO2e, as saved
  note          text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (facility_id, year)
);

-- The survey answers as read from the file (one row per respondent), kept for audit.
CREATE TABLE IF NOT EXISTS commute_response (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  record_id   uuid NOT NULL REFERENCES commute_record(id) ON DELETE CASCADE,
  row_no      int  NOT NULL,
  mode        text NOT NULL,
  km          numeric(10,2),
  days        numeric(4,2),
  occupants   numeric(4,1),
  fuel        text,
  mode2       text,
  km2         numeric(10,2),
  raw         jsonb
);
CREATE INDEX IF NOT EXISTS commute_response_record ON commute_response(record_id);

ALTER TABLE activity ADD COLUMN IF NOT EXISTS commute_record_id uuid REFERENCES commute_record(id);
CREATE INDEX IF NOT EXISTS activity_commute ON activity(commute_record_id) WHERE commute_record_id IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['commute_record','commute_response'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

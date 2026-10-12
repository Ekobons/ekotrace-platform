-- Surveys (Capture → Surveys): employee commuting asked in Ekotrace itself.
--
-- An admin creates a survey for a year and some facilities, adds the people to ask (each gets a
-- personal 8-character code), opens it and sends the invitations. People answer without signing in
-- ("Answering a survey?" on the sign-in page, then their code). The answers are scaled up to each
-- facility's headcount and published into Scope 3 · Employee commuting: one commuting record per
-- facility and year (the same as typed in or uploaded), with its monthly entries.
SELECT set_config('app.platform', 'on', true);

CREATE TABLE IF NOT EXISTS survey (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  type          text NOT NULL DEFAULT 'commute' CHECK (type IN ('commute')),
  name          text NOT NULL,
  year          int  NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  close_at      date,
  weeks         int  NOT NULL DEFAULT 46 CHECK (weeks BETWEEN 1 AND 52),
  wfh           boolean NOT NULL DEFAULT false,
  facility_ids  uuid[] NOT NULL,
  headcount     jsonb NOT NULL DEFAULT '{}',     -- facility id → employees in scope (from the facility, changeable per survey)
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed','published')),
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  opened_at     timestamptz,
  closed_at     timestamptz,
  published_at  timestamptz,
  published_by  text,
  published     jsonb                            -- what was published: per facility the record, tCO2e, entries
);

CREATE TABLE IF NOT EXISTS survey_participant (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  survey_id    uuid NOT NULL REFERENCES survey(id) ON DELETE CASCADE,
  name         text NOT NULL,
  email        text,
  facility_id  uuid NOT NULL REFERENCES org_node(id),
  department   text,
  code         text NOT NULL UNIQUE,             -- personal code, unique across all companies (it is how an answer finds its survey)
  sent_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS survey_participant_email ON survey_participant(survey_id, lower(email)) WHERE email IS NOT NULL AND email <> '';
CREATE INDEX IF NOT EXISTS survey_participant_survey ON survey_participant(survey_id);

CREATE TABLE IF NOT EXISTS survey_response (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  survey_id       uuid NOT NULL REFERENCES survey(id) ON DELETE CASCADE,
  participant_id  uuid NOT NULL UNIQUE REFERENCES survey_participant(id) ON DELETE CASCADE,
  facility_id     uuid NOT NULL REFERENCES org_node(id),
  answers         jsonb NOT NULL,                -- days, wfh, legs [{mode, km}], fuel, occ
  entered_by      text,                          -- a person who typed it in on the employee's behalf
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS survey_response_survey ON survey_response(survey_id);

ALTER TABLE commute_record ADD COLUMN IF NOT EXISTS survey_id uuid REFERENCES survey(id) ON DELETE SET NULL;

-- Home working (optional in the GHG Protocol for category 7): DESNZ office equipment per FTE working hour.
INSERT INTO unit (code, name, dimension, to_base, is_base, aliases, sort) VALUES
  ('fte_h', 'FTE working hour', 'working_time', 1, true, '{per FTE Working Hour,FTE hour}', 91)
ON CONFLICT (code) DO NOTHING;
INSERT INTO subcategory (category_id, code, name, units, default_unit, sort)
SELECT c.id, 'commute_home', 'Home working', '{fte_h}', 'fte_h', 7 FROM category c WHERE c.code = 'employee_commuting'
ON CONFLICT (category_id, code) DO NOTHING;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['survey','survey_participant','survey_response'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

-- Audit & assurance: the assurance engagement, period locks (enforced in the database), samples with test
-- results, and findings from raising to closing.
CREATE TABLE IF NOT EXISTS period_lock (
  tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  month      date NOT NULL CHECK (extract(day FROM month) = 1),
  locked_by  text, locked_at timestamptz NOT NULL DEFAULT now(), reason text,
  PRIMARY KEY (tenant_id, month)
);

-- No entry can be added, changed or removed in a locked month — whatever screen, import or recalculation tries.
CREATE OR REPLACE FUNCTION activity_period_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; m date;
BEGIN
  FOR r IN SELECT * FROM (SELECT NEW.tenant_id AS t, NEW.period_start AS s, NEW.period_end AS e WHERE TG_OP <> 'DELETE'
                          UNION ALL SELECT OLD.tenant_id, OLD.period_start, OLD.period_end WHERE TG_OP <> 'INSERT') x LOOP
    SELECT pl.month INTO m FROM period_lock pl WHERE pl.tenant_id = r.t AND pl.month BETWEEN date_trunc('month', r.s)::date AND date_trunc('month', r.e)::date LIMIT 1;
    IF m IS NOT NULL THEN
      RAISE EXCEPTION 'The period % is locked for assurance: ask an admin to unlock it (with a reason) on Audit & assurance', to_char(m, 'Mon YYYY') USING ERRCODE = 'EKLCK';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS activity_period_lock ON activity;
CREATE TRIGGER activity_period_lock BEFORE INSERT OR UPDATE OR DELETE ON activity FOR EACH ROW EXECUTE FUNCTION activity_period_lock();

CREATE TABLE IF NOT EXISTS assurance_engagement (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  year         int NOT NULL,
  standard     text NOT NULL,          -- ISO 14064-3, ISAE 3410, ISAE 3000, ISSA 5000, AA1000AS v3, other
  level        text NOT NULL CHECK (level IN ('limited', 'reasonable')),
  provider     text, lead text,
  scope        text,                   -- what is assured, e.g. Scope 1, 2 and 3.6
  materiality  numeric CHECK (materiality > 0 AND materiality <= 20),   -- % of total
  status       text NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'fieldwork', 'reporting', 'issued')),
  opinion      text,                   -- conclusion, as written in the statement
  statement_id uuid REFERENCES document(id) ON DELETE SET NULL,
  issued_on    date,
  updated_by   text, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, year)
);

CREATE TABLE IF NOT EXISTS assurance_sample (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  year        int NOT NULL,
  method      text NOT NULL CHECK (method IN ('random', 'value')),
  seed        int NOT NULL,
  size        int NOT NULL,
  key_items   int NOT NULL DEFAULT 0,  -- entries above the key-item threshold, always included
  population  int NOT NULL, population_t numeric NOT NULL,
  created_by  text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS assurance_test (
  sample_id   uuid NOT NULL REFERENCES assurance_sample(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  key_item    boolean NOT NULL DEFAULT false,
  result      text CHECK (result IN ('agreed', 'exception')),
  note        text, tested_by text, tested_at timestamptz,
  PRIMARY KEY (sample_id, activity_id)
);

CREATE TABLE IF NOT EXISTS assurance_finding (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  year        int NOT NULL,
  activity_id uuid REFERENCES activity(id) ON DELETE SET NULL,
  facility_id uuid REFERENCES org_node(id),
  severity    text NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  kind        text NOT NULL DEFAULT 'misstatement' CHECK (kind IN ('misstatement', 'evidence', 'control', 'method', 'other')),
  text        text NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
  impact_t    numeric,                 -- estimated misstatement, tCO2e
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'responded', 'closed')),
  response    text, responded_by text, responded_at timestamptz,
  raised_by   text, raised_at timestamptz NOT NULL DEFAULT now(),
  closed_by   text, closed_at timestamptz, close_note text
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['period_lock', 'assurance_engagement', 'assurance_sample', 'assurance_test', 'assurance_finding'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

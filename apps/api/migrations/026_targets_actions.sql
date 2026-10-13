-- Targets & actions (as in the prototype): the SBTi target structure, extra objectives, scenarios,
-- reduction actions (from the library or custom) with costs, savings and delivery, and saved
-- lever scenarios from the scenario lab.
--
-- The main targets stay on tenant (target_year, target_s12_pct, target_s3_pct, migration 025).
SELECT set_config('app.platform', 'on', true);

-- SBTi target structure, business growth for projections, Net Zero year and residual share
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS sbti jsonb NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS target_objective (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  scope       text NOT NULL CHECK (scope IN ('Scope 1+2', 'Scope 3', 'All scopes', 'Scope 1', 'Scope 2')),
  target_year int  NOT NULL CHECK (target_year BETWEEN 2000 AND 2100),
  pct         numeric NOT NULL CHECK (pct BETWEEN 0 AND 100),
  growth      numeric NOT NULL DEFAULT 2 CHECK (growth BETWEEN -50 AND 50),
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- a scenario = a set of selected actions; every company has a default "Current plan"
CREATE TABLE IF NOT EXISTS scenario (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  is_default  boolean NOT NULL DEFAULT false,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS scenario_one_default ON scenario (tenant_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS reduction_action (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  lib         text,                                  -- library action code; null = custom
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  cat         text NOT NULL DEFAULT 'Other',
  scopes      int[] NOT NULL DEFAULT '{}',
  kpi         text,                                  -- the metric followed
  obj_val     numeric,                               -- objective value (%, adoption)
  start_year  int NOT NULL CHECK (start_year BETWEEN 2000 AND 2100),
  end_year    int NOT NULL CHECK (end_year BETWEEN 2000 AND 2100),
  abate       numeric NOT NULL DEFAULT 0,            -- planned reduction, tCO2e a year once fully delivered
  capex       numeric NOT NULL DEFAULT 0,
  opex        numeric NOT NULL DEFAULT 0,            -- a year
  saving      numeric NOT NULL DEFAULT 0,            -- a year
  life        int NOT NULL DEFAULT 10 CHECK (life BETWEEN 1 AND 60),
  status      text NOT NULL DEFAULT 'Idea' CHECK (status IN ('Idea', 'Approved', 'In progress', 'Done')),
  owner       text,
  facility_id uuid REFERENCES org_node(id),          -- null = company-wide
  excluded    boolean NOT NULL DEFAULT false,
  actual      numeric,                               -- measured reduction, t a year
  actual_note text,
  capex_meth  text,
  opex_meth   text,
  comment     text,
  scenario_ids uuid[] NOT NULL DEFAULT '{}',
  deleted     boolean NOT NULL DEFAULT false,
  created_by  text,
  updated_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_year >= start_year)
);
CREATE INDEX IF NOT EXISTS reduction_action_tenant ON reduction_action (tenant_id) WHERE NOT deleted;

-- scenario lab: saved lever settings
CREATE TABLE IF NOT EXISTS lever_scenario (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  levers      jsonb NOT NULL,
  end_t       numeric,
  year        int,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['target_objective', 'scenario', 'reduction_action', 'lever_scenario'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

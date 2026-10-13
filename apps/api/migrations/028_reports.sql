-- Reports (as in the prototype): reporting-entity details and exclusion justifications, report
-- templates (sections in order), saved versions (a frozen inventory to compare with today), and
-- justifications for data-quality warnings.
SELECT set_config('app.platform', 'on', true);

ALTER TABLE tenant ADD COLUMN IF NOT EXISTS report jsonb NOT NULL DEFAULT '{}';   -- {entity: {...}, excl: {code: text}}

CREATE TABLE IF NOT EXISTS report_template (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  base        text,                                   -- built-in template it replaces (board, ghgp, moccae), or null
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  audience    text,
  note        text,
  sections    text[] NOT NULL,
  created_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS report_version (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  label       text NOT NULL,                          -- what was viewed (company, sub-group, facility, group)
  period      text NOT NULL,                          -- e.g. 2026 · Jan–Sep
  scope2      text NOT NULL CHECK (scope2 IN ('location', 'market')),
  s1          numeric NOT NULL, s2 numeric NOT NULL, s3 numeric NOT NULL,
  by_code     jsonb NOT NULL,                         -- GHG Protocol category → tCO2e
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS report_justification (
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  year        int NOT NULL,
  check_id    text NOT NULL,
  text        text NOT NULL CHECK (length(text) BETWEEN 1 AND 1000),
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, year, check_id)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['report_template', 'report_version', 'report_justification'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

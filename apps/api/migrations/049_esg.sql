-- ESG: frameworks chosen, double materiality assessment per year, ESG data answers.
--
--   esg_assessment   one per company and year: industry, frameworks, thresholds, value chain, stakeholders,
--                    methodology; draft → approved (by a second person)
--   esg_topic        one per topic of the assessment: impact (inside-out) and financial (outside-in) scores
--   esg_answer       the ESG data of the year, one per question code
-- Suppliers' answers to the "ESG impact" section of the supplier portal live in supplier_request.answers (esg).
SELECT set_config('app.platform', 'on', true);

CREATE TABLE IF NOT EXISTS esg_assessment (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  year          int NOT NULL CHECK (year BETWEEN 2015 AND 2100),
  industry      text,
  frameworks    text[] NOT NULL DEFAULT '{}',
  threshold_impact    numeric NOT NULL DEFAULT 3 CHECK (threshold_impact BETWEEN 1 AND 5),
  threshold_financial numeric NOT NULL DEFAULT 3 CHECK (threshold_financial BETWEEN 1 AND 5),
  value_chain   text NOT NULL DEFAULT '',
  stakeholders  jsonb NOT NULL DEFAULT '[]',     -- [{group, method, when, people}]
  methodology   text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved')),
  sent_by uuid REFERENCES app_user(id) ON DELETE SET NULL, sent_name text,
  approved_by uuid REFERENCES app_user(id) ON DELETE SET NULL, approved_name text, approved_at timestamptz, approval_note text,
  updated_by uuid REFERENCES app_user(id) ON DELETE SET NULL, updated_name text, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, year)
);

CREATE TABLE IF NOT EXISTS esg_topic (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  assessment_id uuid NOT NULL REFERENCES esg_assessment(id) ON DELETE CASCADE,
  topic         text NOT NULL,
  impact        jsonb,          -- {type, nature, scale, scope, irremediability, likelihood, humanRights, where[], description}
  financial     jsonb,          -- {kind, magnitude, likelihood, horizon, description}
  impact_score  numeric, financial_score numeric,
  material      boolean,        -- null: follows the scores; true/false: decided with a reason
  rationale     text NOT NULL DEFAULT '',
  UNIQUE (assessment_id, topic)
);

CREATE TABLE IF NOT EXISTS esg_answer (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  year        int NOT NULL,
  code        text NOT NULL,
  value       text,
  num         numeric,
  note        text NOT NULL DEFAULT '',
  updated_name text, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, year, code)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['esg_assessment', 'esg_topic', 'esg_answer'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

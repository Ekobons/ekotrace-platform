-- Home and KPI dashboard (as in the prototype).
--
-- Targets: −x% Scope 1+2 and −y% Scope 3 by a target year, from the base year (straight-line path);
-- used by Home ("Scope 1+2 vs target path", the monthly chart's target line) and the KPI dashboard
-- ("Emissions vs target"). Collection rules: data for a month is due on a day of the next month;
-- reminders some days before, escalation some days after (Home's cycle strip).
-- KPI dashboard: the KPIs shown (from the library) and their targets per viewing selection.
SELECT set_config('app.platform', 'on', true);

ALTER TABLE tenant ADD COLUMN IF NOT EXISTS target_year    int     NOT NULL DEFAULT 2030;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS target_s12_pct numeric NOT NULL DEFAULT 42 CHECK (target_s12_pct BETWEEN 0 AND 100);
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS target_s3_pct  numeric NOT NULL DEFAULT 25 CHECK (target_s3_pct BETWEEN 0 AND 100);
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS due_day        int     NOT NULL DEFAULT 10 CHECK (due_day BETWEEN 1 AND 28);
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS remind_days    int     NOT NULL DEFAULT 3  CHECK (remind_days BETWEEN 0 AND 30);
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS escalate_days  int     NOT NULL DEFAULT 7  CHECK (escalate_days BETWEEN 1 AND 90);

CREATE TABLE IF NOT EXISTS kpi_config (
  tenant_id   uuid PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  list        jsonb NOT NULL DEFAULT '["tot","purch","div","ren","fleet","pemp"]',
  targets     jsonb NOT NULL DEFAULT '{}',     -- selection key (company, node id, group id) → {kpi id: target}
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE kpi_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON kpi_config;
CREATE POLICY tenant_isolation ON kpi_config
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on');

-- A company with one user (a super admin) enters and approves its own data: marked self-reviewed.
ALTER TABLE activity ADD COLUMN IF NOT EXISTS self_reviewed boolean NOT NULL DEFAULT false;

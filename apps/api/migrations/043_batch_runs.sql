-- Batch runs (RFP 3.3.3, 3.3.5, 3.3.6, 6.2): every transfer a connected system makes (meter readings, purchase
-- lines) is logged as a run, with what it sent, what was accepted and what was refused and why, including calls
-- that failed outright. Per client: integration health (last success, failures, expected frequency, alerts).
-- Per batch: reconciliation of the source's control totals against what the platform received, excluded,
-- published and holds in entries. Failed processing can be retried.
SELECT set_config('app.platform', 'on', true);

CREATE TABLE IF NOT EXISTS integration_run (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  api_key_id   uuid REFERENCES api_key(id) ON DELETE SET NULL,
  client       text,                                   -- the API client's name when the call came
  source       text NOT NULL,                          -- meter_readings, purchases, purchases_complete
  endpoint     text NOT NULL,
  status       text NOT NULL CHECK (status IN ('ok', 'partial', 'failed')),
  http_status  int NOT NULL,
  received     int NOT NULL DEFAULT 0,                 -- records in the call
  accepted     int NOT NULL DEFAULT 0,
  rejected     int NOT NULL DEFAULT 0,
  error        text,                                   -- why the call failed (as returned to the sender)
  problems     jsonb NOT NULL DEFAULT '[]',            -- a sample of refused records with their reasons
  reference    text,                                   -- the sender's batch reference (purchases)
  ref_kind     text CHECK (ref_kind IN ('purchase_batch', 'reading_batch')),
  ref_id       uuid,
  duration_ms  int,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS integration_run_t ON integration_run (tenant_id, at DESC);
CREATE INDEX IF NOT EXISTS integration_run_key ON integration_run (api_key_id, at DESC);
ALTER TABLE integration_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_run FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON integration_run;
CREATE POLICY tenant_isolation ON integration_run
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on');

-- how often a client is expected to send (hours); alerts already sent (once per gap / once an hour for failures)
ALTER TABLE api_key ADD COLUMN IF NOT EXISTS expect_hours int CHECK (expect_hours BETWEEN 1 AND 2160);
ALTER TABLE api_key ADD COLUMN IF NOT EXISTS stale_alert_at timestamptz;
ALTER TABLE api_key ADD COLUMN IF NOT EXISTS fail_alert_at timestamptz;

-- the source system's control totals for a purchase batch: { lines, amounts: { CUR: total }, by, at }
ALTER TABLE purchase_batch ADD COLUMN IF NOT EXISTS control jsonb;

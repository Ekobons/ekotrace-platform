-- CBAM communication to EU importers (reporting declarants): what an installation outside the EU sends for each
-- reporting period (usually a quarter), following the European Commission's "CBAM Communication template for
-- installations". The whole template is kept as one document (data); the platform fills the official workbook
-- from it. Optionally tied to a CBAM installation and the facility it is.
CREATE TABLE IF NOT EXISTS cbam_communication (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  installation_id uuid REFERENCES cbam_installation(id) ON DELETE SET NULL,
  title           text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  period_start    date,
  period_end      date,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final', 'sent')),
  data            jsonb NOT NULL DEFAULT '{}',
  template        text NOT NULL DEFAULT 'v2.1',
  sent_to         text NOT NULL DEFAULT '' CHECK (length(sent_to) <= 1000),   -- importers it was sent to
  created_name    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_name    text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cbam_communication_tenant ON cbam_communication (tenant_id, period_start DESC);

ALTER TABLE cbam_communication ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbam_communication FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cbam_communication;
CREATE POLICY tenant_isolation ON cbam_communication
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on');

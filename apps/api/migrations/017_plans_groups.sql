-- Subscription details kept with the plan (platform console), and dashboard groups:
-- any mix of facilities viewed together, without changing the structure.

ALTER TABLE tenant ADD COLUMN IF NOT EXISTS price numeric(14,2);                 -- agreed price, in the billing currency
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS billing_currency text NOT NULL DEFAULT 'AED';
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS billing_cycle text NOT NULL DEFAULT 'annual' CHECK (billing_cycle IN ('annual','monthly'));
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS po_ref text;                         -- purchase order / contract reference
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS billing_email text;

CREATE TABLE IF NOT EXISTS dashboard_group (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name          text NOT NULL,
  facility_ids  uuid[] NOT NULL,
  created_by    uuid,
  created_by_name text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
ALTER TABLE dashboard_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_group FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON dashboard_group;
CREATE POLICY tenant_isolation ON dashboard_group
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on');

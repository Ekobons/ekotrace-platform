-- Which categories apply to a facility. No row = applies (the default). A category marked not applicable
-- is hidden in Add data, is never "Missing" (Add data, Data progress, data-quality checks, collection
-- calendar), and keeps its reason for the report's boundary note. Data entered before stays.
CREATE TABLE IF NOT EXISTS facility_category (
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  facility_id   uuid NOT NULL REFERENCES org_node(id) ON DELETE CASCADE,
  category_code text NOT NULL,
  applicable    boolean NOT NULL DEFAULT true,
  reason        text NOT NULL DEFAULT '' CHECK (length(reason) <= 300),
  updated_by    uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_name  text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (facility_id, category_code)
);
CREATE INDEX IF NOT EXISTS facility_category_tenant ON facility_category (tenant_id);

ALTER TABLE facility_category ENABLE ROW LEVEL SECURITY;
ALTER TABLE facility_category FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON facility_category;
CREATE POLICY tenant_isolation ON facility_category
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on');

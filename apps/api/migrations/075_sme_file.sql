-- EKOTRACE SME: proof documents attached to a page or to one item on it (a certificate, a policy, a bill,
-- a POSH report, DPDP evidence). Kept in the database like bills (010); at most 10 MB each.
CREATE TABLE sme_file (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  fy            text NOT NULL CHECK (fy ~ '^FY [0-9]{4}-[0-9]{2}$'),
  module        text NOT NULL CHECK (module ~ '^[a-z_]{2,20}$'),
  item_key      text NOT NULL DEFAULT '' CHECK (length(item_key) <= 60),
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  mime          text NOT NULL,
  size          integer NOT NULL CHECK (size > 0 AND size <= 10485760),
  sha256        text NOT NULL,
  data          bytea NOT NULL,
  uploaded_name text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sme_file_item ON sme_file (tenant_id, fy, module, item_key);
ALTER TABLE sme_file ENABLE ROW LEVEL SECURITY;
ALTER TABLE sme_file FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sme_file
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on');

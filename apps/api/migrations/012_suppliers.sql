-- Suppliers: one record per real supplier, however its name is written.
--
--   Every purchase intake (upload, ERP API, by hand) links each line to a supplier:
--   vendor number → exact name or known alias → similar name. Near-certain matches are
--   linked automatically (and listed, so a person can undo them); likely ones become a
--   new supplier marked "possible duplicate of …" for a person to merge or keep apart.
--   The rest of the profile (country, contacts, targets…) is completed on the Suppliers page.

ALTER TABLE supplier ADD COLUMN IF NOT EXISTS trn text;                 -- tax registration number
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS industry text;
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS size text CHECK (size IN ('micro','small','medium','large'));
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS reports_emissions text CHECK (reports_emissions IN ('yes','no','unknown'));
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS climate_target text CHECK (climate_target IN ('sbti_validated','sbti_committed','own','none','unknown'));
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS review text NOT NULL DEFAULT 'ok' CHECK (review IN ('ok','possible_duplicate'));
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS duplicate_of uuid REFERENCES supplier(id) ON DELETE SET NULL;
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS duplicate_score numeric(5,4);
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS supplier_reference ON supplier(tenant_id, lower(reference)) WHERE reference IS NOT NULL;

-- How each spelling seen in purchase lines was linked to a supplier (for review and undo).
CREATE TABLE IF NOT EXISTS supplier_match (
  id           bigserial PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  supplier_id  uuid NOT NULL REFERENCES supplier(id) ON DELETE CASCADE,
  name_seen    text NOT NULL,                 -- as written in the file
  norm         text NOT NULL,
  method       text NOT NULL CHECK (method IN ('new','exact','alias','reference','similar','merged','manual')),
  score        numeric(5,4),
  similar_to   text,                          -- the name it was matched with (similar)
  confirmed    boolean NOT NULL DEFAULT false,
  batch_id     uuid REFERENCES purchase_batch(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, norm)
);
CREATE INDEX IF NOT EXISTS supplier_match_supplier ON supplier_match(supplier_id);

-- What the file says about the supplier, besides its name.
ALTER TABLE purchase_line ADD COLUMN IF NOT EXISTS supplier_ref text;
ALTER TABLE purchase_line ADD COLUMN IF NOT EXISTS supplier_country text;

ALTER TABLE supplier_match ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_match FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON supplier_match;
CREATE POLICY tenant_isolation ON supplier_match
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on');

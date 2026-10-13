-- QR & field app: bins (collection points) with a QR label; field scans (weight, fill level, collection with
-- the manifest / weighbridge ticket); scans roll up into the month's waste entries (Scope 3.5, waste sent out).
CREATE TABLE IF NOT EXISTS waste_bin (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  facility_id  uuid NOT NULL REFERENCES org_node(id),
  code         text NOT NULL UNIQUE,                 -- in the QR label: /scan/<code>; identifies, carries no data
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  location     text,
  item_id      int NOT NULL REFERENCES item(id),     -- material and usual disposal method (waste sent out)
  gri          text,                                 -- GRI 306 operation when not the item's own route
  hazardous    boolean NOT NULL DEFAULT false,
  contractor   text,
  capacity_l   numeric CHECK (capacity_l > 0),
  density      numeric CHECK (density > 0),          -- kg per litre, to estimate from the fill level
  active       boolean NOT NULL DEFAULT true,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS waste_bin_fac ON waste_bin (tenant_id, facility_id) WHERE active;

CREATE TABLE IF NOT EXISTS waste_scan (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  bin_id       uuid NOT NULL REFERENCES waste_bin(id) ON DELETE CASCADE,
  facility_id  uuid NOT NULL REFERENCES org_node(id),
  kind         text NOT NULL CHECK (kind IN ('weigh', 'fill', 'collection')),
  kg           numeric NOT NULL CHECK (kg >= 0),     -- weighed, estimated from the fill level, or the weighbridge weight
  fill_pct     numeric CHECK (fill_pct BETWEEN 0 AND 100),
  estimated    boolean NOT NULL DEFAULT false,
  manifest     text,
  note         text,
  lat          numeric, lon numeric,
  flags        text[] NOT NULL DEFAULT '{}',
  at           timestamptz NOT NULL DEFAULT now(),
  by_user      text,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'rolled', 'void')),
  activity_id  uuid REFERENCES activity(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS waste_scan_bin ON waste_scan (bin_id, at);
CREATE INDEX IF NOT EXISTS waste_scan_fac ON waste_scan (tenant_id, facility_id, at);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['waste_bin', 'waste_scan'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

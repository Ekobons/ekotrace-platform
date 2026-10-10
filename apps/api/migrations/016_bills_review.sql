-- Bills per category, checked then previewed before they are published; meter readings sent
-- through the API wait in a batch with the same preview (new / corrections / duplicates).

ALTER TABLE bill ADD COLUMN IF NOT EXISTS category text;          -- the Add data tab it belongs to (purchased_electricity, stationary_combustion, waste_…)
ALTER TABLE bill DROP CONSTRAINT IF EXISTS bill_status_check;
ALTER TABLE bill ADD CONSTRAINT bill_status_check CHECK (status IN ('to_check','checked','confirmed','rejected'));
CREATE INDEX IF NOT EXISTS bill_category ON bill(tenant_id, category, status);
CREATE INDEX IF NOT EXISTS bill_number ON bill(tenant_id, lower(bill_no)) WHERE bill_no IS NOT NULL;

-- Readings received through the API: kept for review before they become readings (company setting).
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS review_readings boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS reading_batch (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  source       text NOT NULL DEFAULT 'api',
  client       text,                                   -- the API client that sent it
  status       text NOT NULL DEFAULT 'review' CHECK (status IN ('review','published','discarded')),
  received     int NOT NULL DEFAULT 0,
  rejected     jsonb NOT NULL DEFAULT '[]',
  result       jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz,
  decided_by   text
);
CREATE INDEX IF NOT EXISTS reading_batch_status ON reading_batch(tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS reading_staged (
  batch_id     uuid NOT NULL REFERENCES reading_batch(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  meter_id     uuid NOT NULL REFERENCES meter(id) ON DELETE CASCADE,
  ts           timestamptz NOT NULL,
  from_ts      timestamptz,
  value        numeric(30,9) NOT NULL,
  state        text NOT NULL CHECK (state IN ('new','changed','same','conflict')),
  old_value    numeric(30,9),
  note         text,
  PRIMARY KEY (batch_id, meter_id, ts)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['reading_batch','reading_staged'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

-- Existing bills: their category from the meter they were booked to.
SELECT set_config('app.platform', 'on', true);
UPDATE bill b SET category = c.code FROM meter m JOIN item i ON i.id = m.item_id JOIN subcategory s ON s.id = i.subcategory_id JOIN category c ON c.id = s.category_id
 WHERE b.meter_id = m.id AND b.category IS NULL;
UPDATE bill SET category = 'purchased_electricity' WHERE category IS NULL AND coalesce(energy, 'electricity') IN ('electricity','cooling','heat');
UPDATE bill SET category = 'stationary_combustion' WHERE category IS NULL;

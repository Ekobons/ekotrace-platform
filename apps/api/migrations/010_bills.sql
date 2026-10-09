-- Bills (PDF): uploaded in one place, read, checked by a person, then booked as a
-- reading of the meter (utility account) they belong to — one value for the billing
-- period, split over calendar months by days, like any other meter reading.

ALTER TABLE meter ADD COLUMN IF NOT EXISTS account_no text;   -- utility account / premise / contract no. on the bills
CREATE INDEX IF NOT EXISTS meter_account ON meter(tenant_id, account_no) WHERE account_no IS NOT NULL;

ALTER TABLE meter_reading DROP CONSTRAINT IF EXISTS meter_reading_source_check;
ALTER TABLE meter_reading ADD CONSTRAINT meter_reading_source_check CHECK (source IN ('api','upload','manual','bill'));

-- Evidence files (bills now; the document vault later). Stored in the database, encrypted at rest with it.
CREATE TABLE IF NOT EXISTS document (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  facility_id   uuid REFERENCES org_node(id),
  kind          text NOT NULL DEFAULT 'bill',
  filename      text NOT NULL,
  content_type  text NOT NULL,
  size          int NOT NULL,
  sha256        text NOT NULL,
  data          bytea NOT NULL,
  uploaded_by   text,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sha256)
);

CREATE TABLE IF NOT EXISTS bill (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  document_id   uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'to_check' CHECK (status IN ('to_check','confirmed','rejected')),
  energy        text,            -- electricity | gas | heat | cooling | fuel
  supplier      text,
  account_no    text,
  bill_no       text,
  period_from   date,
  period_to     date,
  issue_date    date,
  quantity      numeric(30,6),
  unit          text REFERENCES unit(code),
  amount        numeric(20,2),
  currency      text,
  found         jsonb NOT NULL DEFAULT '{}',   -- what the reader found, per field, with the text it came from
  text_excerpt  text,                          -- first part of the text read (for search and checking)
  scanned       boolean NOT NULL DEFAULT false,
  meter_id      uuid REFERENCES meter(id),
  reading_ts    timestamptz,                   -- the meter reading this bill became
  note          text,
  checked_by    text,
  checked_at    timestamptz,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bill_status ON bill(tenant_id, status);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['document','bill'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

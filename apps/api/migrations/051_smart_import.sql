-- Smart import: any emissions spreadsheet → proposed entries, reviewed by a person, then created and submitted.
--   import_job    one per uploaded file (the file itself is kept in the document vault as evidence)
--   import_sheet  each sheet: its first rows (raw cells) and the column mapping (proposed by AI, worked out, or set by a person)
--   import_row    one proposed entry: facility, month, activity, quantity, unit → status ready / check / problem / excluded / created
--   import_rule   remembered answers: an activity description → catalogue item, a facility name → facility
SELECT set_config('app.platform', 'on', true);
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS ai_import boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS import_job (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  filename     text NOT NULL,
  document_id  uuid REFERENCES document(id) ON DELETE SET NULL,
  status       text NOT NULL DEFAULT 'review' CHECK (status IN ('review', 'done')),
  ai_used      boolean NOT NULL DEFAULT false,
  ai_note      text,
  created_by   text, created_name text, created_at timestamptz NOT NULL DEFAULT now(),
  done_at      timestamptz, summary jsonb
);
CREATE TABLE IF NOT EXISTS import_sheet (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  job_id       uuid NOT NULL REFERENCES import_job(id) ON DELETE CASCADE,
  sort         int NOT NULL DEFAULT 0,
  name         text NOT NULL,
  rows         jsonb NOT NULL,           -- the sheet's cells (first 5,000 rows, 80 columns)
  total_rows   int NOT NULL DEFAULT 0,
  mapping      jsonb NOT NULL DEFAULT '{}',
  proposed_by  text NOT NULL DEFAULT 'auto' CHECK (proposed_by IN ('ai', 'auto', 'person')),
  note         text
);
CREATE TABLE IF NOT EXISTS import_row (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  job_id        uuid NOT NULL REFERENCES import_job(id) ON DELETE CASCADE,
  sheet_id      uuid NOT NULL REFERENCES import_sheet(id) ON DELETE CASCADE,
  row_no        int NOT NULL, col int,
  facility_text text, facility_id uuid REFERENCES org_node(id) ON DELETE SET NULL,
  period_start  date, period_end date,
  description   text, category_text text,
  item_id       int REFERENCES item(id), item_method text, item_conf numeric,
  quantity      numeric, unit_text text, unit text, note text, data_type text NOT NULL DEFAULT 'actual',
  status        text NOT NULL DEFAULT 'problem' CHECK (status IN ('ready', 'check', 'problem', 'excluded', 'created')),
  problems      text[] NOT NULL DEFAULT '{}',
  warnings      text[] NOT NULL DEFAULT '{}',     -- from the dry-run calculation (e.g. no grid factor yet)
  person        boolean NOT NULL DEFAULT false,   -- excluded / included by a person: kept when the mapping is applied again
  facility_person boolean NOT NULL DEFAULT false, -- facility chosen by a person
  co2e          numeric, activity_id uuid REFERENCES activity(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS import_row_job ON import_row (job_id, status);
CREATE TABLE IF NOT EXISTS import_rule (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('item', 'facility')),
  pattern      text NOT NULL,
  item_id      int REFERENCES item(id) ON DELETE CASCADE,
  facility_id  uuid REFERENCES org_node(id) ON DELETE CASCADE,
  created_name text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, pattern)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['import_job', 'import_sheet', 'import_row', 'import_rule'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

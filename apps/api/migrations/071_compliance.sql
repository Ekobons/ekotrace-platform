-- Compliance Position Desk (a package of its own: tenant.products 'compliance').
--   cp_profile  the facts that decide which regulations apply (listing, size, countries, imports…), one per company
--   cp_status   the status of an obligation for a reporting period: owner, note, evidence, completed on, date moved
--   cp_custom   the company's own obligations (permits, licences, voluntary commitments), once or every year
SELECT set_config('app.platform', 'on', true);

ALTER TABLE tenant DROP CONSTRAINT IF EXISTS tenant_products_check;
ALTER TABLE tenant ADD CONSTRAINT tenant_products_check CHECK (products <@ ARRAY['ekotrace', 'ekofin', 'cbam', 'ccts', 'brsr', 'uaemrv', 'energy', 'compliance']::text[] AND cardinality(products) >= 1);

CREATE TABLE IF NOT EXISTS cp_profile (
  tenant_id     uuid PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  data          jsonb NOT NULL DEFAULT '{}',
  updated_name  text, updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cp_status (
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  reg           text NOT NULL CHECK (reg ~ '^[a-z0-9_:-]{2,60}$'),
  obligation    text NOT NULL CHECK (obligation ~ '^[a-z0-9_-]{1,40}$'),
  period        int NOT NULL CHECK (period BETWEEN 2000 AND 2100),
  status        text CHECK (status IN ('not_started', 'in_progress', 'done', 'not_applicable')),   -- null: as the module says
  owner         text CHECK (owner IS NULL OR length(owner) <= 120),
  note          text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  document_id   uuid REFERENCES document(id) ON DELETE SET NULL,
  done_on       date,
  due_override  date,
  updated_name  text, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, reg, obligation, period)
);

CREATE TABLE IF NOT EXISTS cp_custom (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  title         text NOT NULL CHECK (length(title) BETWEEN 2 AND 300),
  regulation    text NOT NULL DEFAULT '' CHECK (length(regulation) <= 300),
  jurisdiction  text NOT NULL DEFAULT '' CHECK (length(jurisdiction) <= 80),
  due_date      date NOT NULL,                 -- the first (or only) due date; every year on the same day when annual
  recurrence    text NOT NULL DEFAULT 'once' CHECK (recurrence IN ('once', 'annual')),
  owner         text CHECK (owner IS NULL OR length(owner) <= 120),
  detail        text NOT NULL DEFAULT '' CHECK (length(detail) <= 2000),
  created_name  text, created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['cp_profile', 'cp_status', 'cp_custom'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

-- EKOTRACE SME: e-mail reminders for the compliance calendar.
--   sme_reminder       per company (not per year): on/off, who receives them, how many days before, and on overdue
--   sme_reminder_sent  one row per calendar item, due date and kind of reminder, so nothing is sent twice
CREATE TABLE IF NOT EXISTS sme_reminder (
  tenant_id     uuid PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  enabled       boolean NOT NULL DEFAULT false,
  recipients    uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(recipients) <= 20),
  days          int[] NOT NULL DEFAULT '{15,3}' CHECK (cardinality(days) BETWEEN 1 AND 5),
  overdue       boolean NOT NULL DEFAULT true,
  updated_name  text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sme_reminder_sent (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  item_id     text NOT NULL CHECK (length(item_id) <= 80),
  title       text NOT NULL DEFAULT '',
  due         date NOT NULL,
  kind        text NOT NULL CHECK (kind ~ '^(d[0-9]{1,2}|overdue)$'),
  recipients  int NOT NULL DEFAULT 0,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, item_id, due, kind)
);
CREATE INDEX IF NOT EXISTS sme_reminder_sent_recent ON sme_reminder_sent (tenant_id, sent_at DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['sme_reminder', 'sme_reminder_sent'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

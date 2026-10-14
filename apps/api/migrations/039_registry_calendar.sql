-- Metric registry (data dictionary), collection calendar, reminders and escalation, notifications and
-- e-mail (RFP 3.2.1, 3.4.1 b–c, 3.4.10).

-- ------------------------------------------------------------------ registry --
-- A metric is one reportable data point: a category, or some items of it ("Grid electricity").
-- Separate from the emission factors: it says WHAT is collected, by whom, how often and with what proof.
CREATE TABLE IF NOT EXISTS metric (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  code           text NOT NULL,                          -- EKO-001…, never changes
  name           text NOT NULL,
  definition     text NOT NULL DEFAULT '',
  category_code  text NOT NULL,                          -- category.code
  item_ids       int[] NOT NULL DEFAULT '{}',            -- empty = the whole category
  unit           text REFERENCES unit(code),             -- reporting unit (NULL: money in the company currency)
  owner_user_id  uuid REFERENCES app_user(id) ON DELETE SET NULL,
  facility_types text[] NOT NULL DEFAULT '{}',           -- applies to these facility types (empty = all)…
  facility_ids   uuid[] NOT NULL DEFAULT '{}',           -- …or only to these facilities (when set)
  required       boolean NOT NULL DEFAULT false,         -- every facility it applies to must report it (else: those that report it)
  level          text NOT NULL DEFAULT 'facility' CHECK (level IN ('facility', 'company')),  -- company: collected once for the whole company (finance, travel agency, survey)
  source_system  text,
  methods        text[] NOT NULL DEFAULT '{}',           -- form, upload, bill, api, qr, survey
  frequency      text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly', 'quarterly', 'annual')),
  due_day        int CHECK (due_day BETWEEN 1 AND 28),   -- NULL: the company's due day
  due_months     int NOT NULL DEFAULT 1 CHECK (due_months BETWEEN 1 AND 6),  -- due in the Nth month after the period
  check_pct      int CHECK (check_pct BETWEEN 1 AND 500),-- NULL: the company's check limit
  evidence       text NOT NULL DEFAULT 'optional' CHECK (evidence IN ('required', 'optional')),
  active         boolean NOT NULL DEFAULT true,
  version        int NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text
);
CREATE UNIQUE INDEX IF NOT EXISTS metric_code ON metric (tenant_id, code);
CREATE INDEX IF NOT EXISTS metric_cat ON metric (tenant_id, category_code);

-- every approved version of every metric, with the reason and who changed and approved it
CREATE TABLE IF NOT EXISTS metric_version (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  metric_id   uuid NOT NULL REFERENCES metric(id) ON DELETE CASCADE,
  version     int NOT NULL,
  snapshot    jsonb NOT NULL,
  changes     jsonb,                                     -- field: [before, after]
  reason      text NOT NULL,
  changed_by  text, approved_by text,
  at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (metric_id, version)
);
-- changes proposed by admins, approved or rejected by a super admin
CREATE TABLE IF NOT EXISTS metric_change (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  metric_id     uuid REFERENCES metric(id) ON DELETE CASCADE,   -- NULL: a new metric
  proposal      jsonb NOT NULL,
  reason        text NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  proposed_by   uuid REFERENCES app_user(id) ON DELETE SET NULL, proposed_name text, proposed_at timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid REFERENCES app_user(id) ON DELETE SET NULL, decided_name text, decided_at timestamptz, decision_note text
);
CREATE INDEX IF NOT EXISTS metric_change_open ON metric_change (tenant_id) WHERE status = 'pending';

-- ------------------------------------------------------------------ calendar --
-- A facility does not have to report a metric for a period (closed, no generator that month…): recorded with the reason.
CREATE TABLE IF NOT EXISTS collection_exception (
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  facility_id  uuid NOT NULL REFERENCES org_node(id) ON DELETE CASCADE,
  metric_id    uuid NOT NULL REFERENCES metric(id) ON DELETE CASCADE,
  period       date NOT NULL,                            -- first day of the period
  reason       text NOT NULL,
  by_user      uuid REFERENCES app_user(id) ON DELETE SET NULL, by_name text,
  at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (facility_id, metric_id, period)
);
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS reminders boolean NOT NULL DEFAULT true;
-- one reminder of each kind per obligation (facility × metric × period); manual ones once a day
CREATE TABLE IF NOT EXISTS reminder_log (
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  key         text NOT NULL,                             -- facility:metric:period
  kind        text NOT NULL,                             -- due_soon | overdue | escalated | manual:YYYY-MM-DD
  recipients  uuid[] NOT NULL DEFAULT '{}',
  by_name     text,
  at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key, kind)
);

-- ------------------------------------------------------------- notifications --
CREATE TABLE IF NOT EXISTS notification (
  id         bigserial PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  kind       text NOT NULL,                              -- reminder | overdue | escalated | returned | metric_change | metric_decision
  title      text NOT NULL,
  body       text,
  link       text,                                       -- a page in Ekotrace (/calendar, /approvals…)
  at         timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);
CREATE INDEX IF NOT EXISTS notification_user ON notification (user_id, at DESC);
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS email_notify boolean NOT NULL DEFAULT true;

-- e-mail waiting to go out (sent by the worker when a mail server is set; kept 90 days)
CREATE TABLE IF NOT EXISTS email_outbox (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid REFERENCES tenant(id) ON DELETE CASCADE,
  to_email    text NOT NULL,
  subject     text NOT NULL,
  body        text NOT NULL,
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'held')),
  attempts    int NOT NULL DEFAULT 0,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);
CREATE INDEX IF NOT EXISTS email_outbox_queued ON email_outbox (id) WHERE status = 'queued';

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['metric', 'metric_version', 'metric_change', 'collection_exception', 'reminder_log', 'notification', 'email_outbox'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

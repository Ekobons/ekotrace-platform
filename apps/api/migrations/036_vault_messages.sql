-- Document vault: every file of the company in one place, filed by facility, period and type,
-- linked to the entries it supports, kept for the retention period. Message centre: conversations
-- with the Ekotrace team, and announcements from the team.

-- ---------------------------------------------------------------- vault --
ALTER TABLE document ADD COLUMN IF NOT EXISTS doc_type     text;          -- permit, certificate, contract… (NULL: from its kind)
ALTER TABLE document ADD COLUMN IF NOT EXISTS title        text;
ALTER TABLE document ADD COLUMN IF NOT EXISTS period_from  date;
ALTER TABLE document ADD COLUMN IF NOT EXISTS period_to    date;
ALTER TABLE document ADD COLUMN IF NOT EXISTS valid_until  date;          -- permits, certificates, calibration
ALTER TABLE document ADD COLUMN IF NOT EXISTS note         text;
ALTER TABLE document ADD COLUMN IF NOT EXISTS tags         text[] NOT NULL DEFAULT '{}';
ALTER TABLE document ADD COLUMN IF NOT EXISTS category     text;          -- data category (subcategory code), optional
ALTER TABLE document ADD COLUMN IF NOT EXISTS version      int NOT NULL DEFAULT 1;
ALTER TABLE document ADD COLUMN IF NOT EXISTS replaces_id  uuid REFERENCES document(id) ON DELETE SET NULL;
ALTER TABLE document ADD COLUMN IF NOT EXISTS replaced_by  uuid REFERENCES document(id) ON DELETE SET NULL;
ALTER TABLE document ADD COLUMN IF NOT EXISTS archived_at  timestamptz;
ALTER TABLE document ADD COLUMN IF NOT EXISTS archived_by  text;
ALTER TABLE document ADD COLUMN IF NOT EXISTS archive_reason text;
ALTER TABLE document DROP CONSTRAINT IF EXISTS document_period_check;
ALTER TABLE document ADD CONSTRAINT document_period_check CHECK (period_to IS NULL OR period_from IS NULL OR period_to >= period_from);
CREATE INDEX IF NOT EXISTS document_list ON document (tenant_id, uploaded_at DESC);

-- How long documents are kept (years after the period they cover, or after upload).
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS doc_retention_years int NOT NULL DEFAULT 7 CHECK (doc_retention_years BETWEEN 1 AND 30);

-- A document supports one or more entries (and an entry may have several documents).
CREATE TABLE IF NOT EXISTS document_link (
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
  linked_by   text,
  linked_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, activity_id)
);
CREATE INDEX IF NOT EXISTS document_link_activity ON document_link (activity_id);

-- Evidence may be added to an entry in a locked month (the verifier often asks for more), never taken away.
CREATE OR REPLACE FUNCTION document_link_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m date;
BEGIN
  SELECT pl.month INTO m FROM activity a JOIN period_lock pl ON pl.tenant_id = a.tenant_id
   AND pl.month BETWEEN date_trunc('month', a.period_start)::date AND date_trunc('month', a.period_end)::date
   WHERE a.id = OLD.activity_id LIMIT 1;
  IF m IS NOT NULL THEN
    RAISE EXCEPTION 'The period % is locked for assurance: evidence cannot be removed from its entries', to_char(m, 'Mon YYYY') USING ERRCODE = 'EKLCK';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS document_link_lock ON document_link;
CREATE TRIGGER document_link_lock BEFORE DELETE ON document_link FOR EACH ROW EXECUTE FUNCTION document_link_lock();

-- ------------------------------------------------------- message centre --
CREATE TABLE IF NOT EXISTS message_thread (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  created_by   uuid NOT NULL REFERENCES app_user(id),
  topic        text NOT NULL CHECK (topic IN ('question', 'data_help', 'problem', 'feature', 'factors', 'billing')),
  subject      text NOT NULL,
  page         text,                                  -- the part of Ekotrace it is about
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_company_at timestamptz NOT NULL DEFAULT now(),  -- last message from the company
  last_team_at    timestamptz,                         -- last reply from the team
  team_read_at    timestamptz,                         -- the team inbox has read up to here
  closed_at    timestamptz, closed_by text
);
CREATE INDEX IF NOT EXISTS message_thread_list ON message_thread (tenant_id, greatest(last_company_at, coalesce(last_team_at, last_company_at)) DESC);

CREATE TABLE IF NOT EXISTS message (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  thread_id   uuid NOT NULL REFERENCES message_thread(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES app_user(id),
  author_name text NOT NULL,
  from_team   boolean NOT NULL DEFAULT false,
  body        text NOT NULL,
  document_id uuid REFERENCES document(id) ON DELETE SET NULL,   -- a screenshot or file
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS message_thread_idx ON message (thread_id, created_at);

-- Each person's read position in a conversation (the company side).
CREATE TABLE IF NOT EXISTS message_read (
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES message_thread(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  read_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['document_link', 'message_thread', 'message', 'message_read'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

-- Announcements from the Ekotrace team: to every company, or to the companies listed.
-- Platform data (no company owns it); read through the API only.
CREATE TABLE IF NOT EXISTS announcement (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL DEFAULT 'news' CHECK (kind IN ('news', 'feature', 'factors', 'maintenance', 'regulation')),
  title        text NOT NULL,
  body         text NOT NULL,
  tenant_ids   uuid[],                                -- NULL = every company
  published_by text,
  published_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,
  withdrawn_at timestamptz
);
CREATE TABLE IF NOT EXISTS announcement_read (
  announcement_id uuid NOT NULL REFERENCES announcement(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

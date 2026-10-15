-- Supplier portal (RFP 8.4: supplier engagement and Scope 3 data collection).
-- A company invites a supplier's contact to report for a year. The contact signs in at /supplier with their work
-- e-mail and an access code (no user account, no password; the code is stored only as a hash, expires and can be
-- replaced or removed) and answers a questionnaire: company profile, emissions inventory and how much of it relates
-- to the customer, climate targets, product carbon footprints, evidence. The company reviews the answers: on
-- acceptance the profile is updated and the factors it chooses become supplier-specific factors (purchases from
-- the supplier are recalculated). Nothing the supplier sends changes the inventory without that review.
SELECT set_config('app.platform', 'on', true);

CREATE TABLE IF NOT EXISTS supplier_request (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  supplier_id   uuid NOT NULL REFERENCES supplier(id) ON DELETE CASCADE,
  year          int NOT NULL CHECK (year BETWEEN 2000 AND 2100),       -- the reporting year asked for
  contact_name  text,
  email         text NOT NULL CHECK (length(email) BETWEEN 3 AND 200),
  message       text NOT NULL DEFAULT '',                              -- the company's note to the supplier
  due_date      date,
  code_hash     text,                                                  -- sha256 of the access code (shown once)
  expires_at    date,
  revoked       boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'in_progress', 'submitted', 'queried', 'accepted')),
  answers       jsonb NOT NULL DEFAULT '{}',                           -- profile, inventory, allocation, targets, products, declaration
  documents     jsonb NOT NULL DEFAULT '[]',                           -- [{ id, filename, kind }] uploaded by the supplier
  submitted_at  timestamptz,
  submitted_by  text,
  review_note   text,                                                  -- why it was queried (the supplier sees it)
  reviewed_by   text, reviewed_at timestamptz,
  applied       jsonb,                                                 -- what acceptance changed (profile fields, factors created)
  last_used_at  timestamptz,
  created_by    text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_request_one ON supplier_request (tenant_id, supplier_id, year);
CREATE INDEX IF NOT EXISTS supplier_request_email ON supplier_request (lower(email)) WHERE NOT revoked;

CREATE TABLE IF NOT EXISTS supplier_session (
  token_hash   text PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  request_id   uuid NOT NULL REFERENCES supplier_request(id) ON DELETE CASCADE,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- a factor created from a supplier's answers points back to them
ALTER TABLE supplier_ef ADD COLUMN IF NOT EXISTS request_id uuid REFERENCES supplier_request(id) ON DELETE SET NULL;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['supplier_request', 'supplier_session'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

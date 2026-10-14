-- Waste contractor portal: the collector / treatment company signs in with its work email and an access code
-- (no password, no user account), sees only the bins assigned to it, records collections (manifest, weighbridge
-- weight, ticket) and sends a monthly statement that BEEAH staff check against their own scans.
CREATE TABLE IF NOT EXISTS waste_contractor (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  email        text NOT NULL CHECK (length(email) BETWEEN 3 AND 200),
  contact      text,
  code_hash    text,                                 -- sha256 of the access code; the code is shown once
  expires_at   date,
  revoked      boolean NOT NULL DEFAULT false,
  last_used_at timestamptz,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS contractor_session (
  token_hash    text PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  contractor_id uuid NOT NULL REFERENCES waste_contractor(id) ON DELETE CASCADE,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE waste_bin ADD COLUMN IF NOT EXISTS contractor_id uuid REFERENCES waste_contractor(id) ON DELETE SET NULL;
ALTER TABLE waste_scan ADD COLUMN IF NOT EXISTS contractor_id uuid REFERENCES waste_contractor(id) ON DELETE SET NULL;  -- entered by the contractor
ALTER TABLE waste_scan ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES document(id) ON DELETE SET NULL;           -- weighbridge ticket / manifest
ALTER TABLE waste_scan ADD COLUMN IF NOT EXISTS vehicle text;

CREATE TABLE IF NOT EXISTS contractor_statement (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  contractor_id uuid NOT NULL REFERENCES waste_contractor(id) ON DELETE CASCADE,
  year          int NOT NULL, month int NOT NULL CHECK (month BETWEEN 1 AND 12),
  lines         jsonb NOT NULL,                      -- [{facilityId, itemId, gri, tonnes}]
  document_id   uuid REFERENCES document(id) ON DELETE SET NULL,  -- the statement / treatment certificate
  note          text,
  status        text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'accepted', 'queried')),
  review_note   text, reviewed_by text, reviewed_at timestamptz,
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contractor_id, year, month)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['waste_contractor', 'contractor_session', 'contractor_statement'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS waste_contractor_email ON waste_contractor (lower(email));

-- The dedicated CBAM tool (importers and exporters):
--   cbam_settings        per company: role in CBAM (importer / exporter / both), EORI, assumptions for forecasts
--   cbam_supplier        installations outside the EU an importer buys from, or precursor suppliers of an exporter
--   cbam_request         a request for emissions data sent to a supplier (per quarter or per import), answered
--                        through the supplier page with an access code, or from the supplier's own account
--   cbam_response        what the supplier sent: the EU template parsed, a short form, or a communication
--   cbam_request_message comments both ways
--   cbam_supplier_value  accepted values (SEE per CN code and period) used on import lines and precursors
--   cbam_signup          self-service sign-up waiting for the e-mail to be confirmed
SELECT set_config('app.platform', 'on', true);

CREATE TABLE IF NOT EXISTS cbam_settings (
  tenant_id     uuid PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'both' CHECK (role IN ('importer', 'exporter', 'both')),
  eori          text CHECK (eori IS NULL OR length(eori) <= 20),
  assumptions   jsonb NOT NULL DEFAULT '{}',          -- forecast: price path, growth, scenarios
  updated_name  text, updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cbam_supplier (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  kind            text NOT NULL DEFAULT 'import' CHECK (kind IN ('import', 'precursor')),
  name            text NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  country         text CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  installation    text CHECK (installation IS NULL OR length(installation) <= 200),
  registry_id     text CHECK (registry_id IS NULL OR length(registry_id) <= 80),   -- installation ID in the CBAM Registry
  contact_name    text CHECK (contact_name IS NULL OR length(contact_name) <= 120),
  contact_email   text CHECK (contact_email IS NULL OR length(contact_email) <= 190),
  notes           text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  created_name    text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cbam_supplier_t ON cbam_supplier (tenant_id, name);

ALTER TABLE cbam_import ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES cbam_supplier(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS cbam_request (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  supplier_id     uuid NOT NULL REFERENCES cbam_supplier(id) ON DELETE CASCADE,
  purpose         text NOT NULL DEFAULT 'import' CHECK (purpose IN ('import', 'precursor')),
  year            int NOT NULL CHECK (year BETWEEN 2023 AND 2100),
  quarter         int CHECK (quarter BETWEEN 1 AND 4),          -- NULL: the whole year
  import_id       uuid REFERENCES cbam_import(id) ON DELETE SET NULL,   -- per import, when asked for one line
  cn_codes        text[] NOT NULL DEFAULT '{}',
  message         text NOT NULL DEFAULT '' CHECK (length(message) <= 4000),
  due_date        date,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'accepted', 'rejected', 'withdrawn')),
  contact_email   text NOT NULL CHECK (length(contact_email) <= 190),
  code_hash       text,                                        -- access code for the supplier page (hash only)
  code_expires    timestamptz,
  reminders       int NOT NULL DEFAULT 0,
  reminded_at     timestamptz,
  created_name    text, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cbam_request_t ON cbam_request (tenant_id, year, status);
CREATE INDEX IF NOT EXISTS cbam_request_email ON cbam_request (lower(contact_email));

CREATE TABLE IF NOT EXISTS cbam_response (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,   -- the company that asked
  request_id      uuid NOT NULL REFERENCES cbam_request(id) ON DELETE CASCADE,
  via             text NOT NULL CHECK (via IN ('template', 'form', 'account')),
  from_tenant     uuid REFERENCES tenant(id) ON DELETE SET NULL,           -- supplier's own company, when sent from an account
  from_name       text, from_email text,
  filename        text,
  data            jsonb NOT NULL,                                          -- {period, installation, goods:[…]}
  status          text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'accepted', 'rejected')),
  review_note     text, reviewed_name text, reviewed_at timestamptz,
  submitted_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cbam_response_r ON cbam_response (request_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS cbam_request_message (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  request_id  uuid NOT NULL REFERENCES cbam_request(id) ON DELETE CASCADE,
  side        text NOT NULL CHECK (side IN ('requester', 'supplier')),
  author      text NOT NULL,
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cbam_request_message_r ON cbam_request_message (request_id, at);

CREATE TABLE IF NOT EXISTS cbam_supplier_value (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  supplier_id     uuid NOT NULL REFERENCES cbam_supplier(id) ON DELETE CASCADE,
  response_id     uuid REFERENCES cbam_response(id) ON DELETE SET NULL,
  cn              text NOT NULL CHECK (cn ~ '^[0-9]{4,8}$'),
  year            int NOT NULL, quarter int CHECK (quarter BETWEEN 1 AND 4),
  see_direct      numeric NOT NULL CHECK (see_direct >= 0),
  see_indirect    numeric NOT NULL DEFAULT 0 CHECK (see_indirect >= 0),
  default_share   numeric CHECK (default_share BETWEEN 0 AND 1),
  installation    text, registry_id text, route text, verified boolean NOT NULL DEFAULT false,
  carbon_price_eur numeric CHECK (carbon_price_eur >= 0),
  accepted_name   text, accepted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cbam_supplier_value_s ON cbam_supplier_value (tenant_id, supplier_id, year, quarter);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['cbam_settings', 'cbam_supplier', 'cbam_request', 'cbam_response', 'cbam_request_message', 'cbam_supplier_value'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

-- sign-ups are platform-level (no company yet): only the platform role reads them
CREATE TABLE IF NOT EXISTS cbam_signup (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company       text NOT NULL CHECK (length(company) BETWEEN 2 AND 160),
  country       text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  role          text NOT NULL CHECK (role IN ('importer', 'exporter', 'both')),
  name          text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  email         text NOT NULL CHECK (length(email) <= 190),
  token_hash    text NOT NULL,
  expires_at    timestamptz NOT NULL,
  done_tenant   uuid REFERENCES tenant(id) ON DELETE SET NULL,
  ip            text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cbam_signup_email ON cbam_signup (lower(email), created_at DESC);
ALTER TABLE cbam_signup ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbam_signup FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_only ON cbam_signup;
CREATE POLICY platform_only ON cbam_signup USING (current_setting('app.platform', true) = 'on') WITH CHECK (current_setting('app.platform', true) = 'on');

-- signed-in supplier on the CBAM supplier page (8 hours; token stored as a hash)
CREATE TABLE IF NOT EXISTS cbam_supplier_session (
  token_hash  text PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  request_id  uuid NOT NULL REFERENCES cbam_request(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL
);
ALTER TABLE cbam_supplier_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE cbam_supplier_session FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cbam_supplier_session;
CREATE POLICY tenant_isolation ON cbam_supplier_session
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on');

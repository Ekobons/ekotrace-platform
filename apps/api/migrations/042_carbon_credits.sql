-- Carbon credits (RFP 8.7; GHG Protocol: reported separately from the inventory; SBTi Corporate Net-Zero
-- Standard: credits do not count towards reduction targets, permanent removals neutralise the residual at net zero;
-- ISO 14068-1 and VCMI Claims Code for claims). Two records:
--
--   carbon_credit_lot         a purchase: project, registry, standard, type (avoidance / nature removal /
--                             technical removal), vintage, quantity, price, quality labels, delivery status
--   carbon_credit_retirement  credits retired (cancelled on the registry) from a lot against a reporting year and
--                             a purpose. A second person approves it; only approved retirements count.
--
-- Credits never change the inventory: gross emissions stay as measured; "net after credits" is shown beside them.
SELECT set_config('app.platform', 'on', true);

CREATE TABLE IF NOT EXISTS carbon_credit_lot (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  project       text NOT NULL CHECK (length(project) BETWEEN 2 AND 200),
  project_id    text,                                   -- the registry's project ID (e.g. VCS 1234)
  registry      text NOT NULL,                          -- Verra, Gold Standard, Puro.earth, Isometric, ACR, CAR, Article 6.4, other
  methodology   text,                                   -- e.g. VM0042, AMS-III.D
  category      text NOT NULL CHECK (category IN ('avoidance', 'removal_nature', 'removal_technical')),
  project_type  text,                                   -- e.g. Landfill gas, ARR, Biochar, DACCS
  country       text,
  vintage       int NOT NULL CHECK (vintage BETWEEN 1990 AND 2100),
  quantity      numeric NOT NULL CHECK (quantity > 0 AND quantity <= 1e9),   -- tCO2e (one credit = one tonne)
  price         numeric CHECK (price >= 0),             -- per tonne
  currency      text NOT NULL DEFAULT 'USD',
  supplier      text,
  contract_date date,
  status        text NOT NULL DEFAULT 'contracted' CHECK (status IN ('contracted', 'delivered', 'cancelled')),
  delivered_on  date,
  serials       text,                                   -- serial range on the registry
  ccp           boolean NOT NULL DEFAULT false,         -- ICVCM Core Carbon Principles label
  corsia        boolean NOT NULL DEFAULT false,         -- CORSIA eligible
  ca            boolean NOT NULL DEFAULT false,         -- Article 6 corresponding adjustment
  permanence    text,                                   -- e.g. "1,000+ years", "40-year buffer"
  document_id   uuid REFERENCES document(id) ON DELETE SET NULL,
  notes         text NOT NULL DEFAULT '',
  created_by    uuid REFERENCES app_user(id) ON DELETE SET NULL, created_name text, created_at timestamptz NOT NULL DEFAULT now(),
  updated_name  text, updated_at timestamptz
);
CREATE INDEX IF NOT EXISTS carbon_credit_lot_t ON carbon_credit_lot (tenant_id, vintage);

CREATE TABLE IF NOT EXISTS carbon_credit_retirement (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  lot_id        uuid NOT NULL REFERENCES carbon_credit_lot(id) ON DELETE RESTRICT,
  quantity      numeric NOT NULL CHECK (quantity > 0),
  retired_on    date NOT NULL,
  claim_year    int NOT NULL CHECK (claim_year BETWEEN 1990 AND 2100),   -- the reporting year the retirement is used for
  purpose       text NOT NULL CHECK (purpose IN ('voluntary', 'neutralisation', 'bvcm', 'corsia', 'compliance')),
  serials       text,
  beneficiary   text,                                   -- as written on the registry's retirement statement
  registry_url  text,
  document_id   uuid REFERENCES document(id) ON DELETE SET NULL,   -- retirement certificate
  note          text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  proposed_by   uuid REFERENCES app_user(id) ON DELETE SET NULL, proposed_name text, proposed_at timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid REFERENCES app_user(id) ON DELETE SET NULL, decided_name text, decided_at timestamptz, decision_note text
);
CREATE INDEX IF NOT EXISTS carbon_credit_retirement_t ON carbon_credit_retirement (tenant_id, claim_year);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['carbon_credit_lot', 'carbon_credit_retirement'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

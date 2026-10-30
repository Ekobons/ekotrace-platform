-- EKOTRACE SME: plan & billing — online payment (Razorpay), tax invoices.
--
--   sme_company.plan_id / gstin / bill_address   the SME plan paid for (id from the 'plans' setting) and the buyer details on its invoices
--   sme_payment        one row per checkout: created when the order is made with Razorpay, 'paid' once verified
--                      (browser handler or webhook — whichever comes first; the payment id is unique, so never applied twice)
--   sme_invoice_seq    invoice serial numbers, consecutive per financial year (GST rule 46: unique per FY, at most 16 characters)
SELECT set_config('app.platform', 'on', true);

ALTER TABLE sme_company ADD COLUMN IF NOT EXISTS plan_id text CHECK (plan_id IS NULL OR plan_id ~ '^[a-z0-9_-]{1,30}$');
ALTER TABLE sme_company ADD COLUMN IF NOT EXISTS gstin text CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z0-9]{13}$');
ALTER TABLE sme_company ADD COLUMN IF NOT EXISTS bill_address text CHECK (bill_address IS NULL OR length(bill_address) <= 400);

CREATE TABLE IF NOT EXISTS sme_payment (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  plan_id         text NOT NULL,
  plan_name       text NOT NULL,
  base_paise      bigint NOT NULL CHECK (base_paise > 0),
  cgst_paise      bigint NOT NULL DEFAULT 0 CHECK (cgst_paise >= 0),
  sgst_paise      bigint NOT NULL DEFAULT 0 CHECK (sgst_paise >= 0),
  igst_paise      bigint NOT NULL DEFAULT 0 CHECK (igst_paise >= 0),
  amount_paise    bigint NOT NULL CHECK (amount_paise = base_paise + cgst_paise + sgst_paise + igst_paise),
  currency        text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  gst_rate        numeric NOT NULL DEFAULT 18,
  status          text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed')),
  rp_order_id     text NOT NULL UNIQUE,
  rp_payment_id   text UNIQUE,
  method          text,
  failure         text CHECK (failure IS NULL OR length(failure) <= 300),
  via             text CHECK (via IS NULL OR via IN ('checkout', 'webhook')),
  seller          jsonb NOT NULL,
  buyer           jsonb NOT NULL,
  period_from     date, period_to date,
  invoice_fy      text CHECK (invoice_fy IS NULL OR invoice_fy ~ '^[0-9]{4}-[0-9]{2}$'),
  invoice_seq     int,
  invoice_no      text UNIQUE CHECK (invoice_no IS NULL OR length(invoice_no) <= 16),
  created_by      uuid, created_name text, created_email text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  paid_at         timestamptz,
  UNIQUE (invoice_fy, invoice_seq)
);
CREATE INDEX IF NOT EXISTS sme_payment_tenant ON sme_payment (tenant_id, created_at DESC);
ALTER TABLE sme_payment ENABLE ROW LEVEL SECURITY;
ALTER TABLE sme_payment FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sme_payment;
CREATE POLICY tenant_isolation ON sme_payment
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on');

-- platform-wide counter (no tenant rows): taken only in platform transactions when a payment is applied
CREATE TABLE IF NOT EXISTS sme_invoice_seq (
  fy    text PRIMARY KEY CHECK (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  last  int NOT NULL CHECK (last >= 0)
);

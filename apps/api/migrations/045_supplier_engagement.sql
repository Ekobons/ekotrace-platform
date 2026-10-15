-- Supplier engagement: suppliers entered by hand or from a list (current suppliers and prospects), procurement
-- department, CDP score, declared reduction target (for supplier trajectories), and the SBTi's public list of
-- companies with targets (shared reference data, loaded by the platform admin) matched to suppliers by name.
SELECT set_config('app.platform', 'on', true);

ALTER TABLE supplier ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'current' CHECK (kind IN ('current', 'prospect'));
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS department text;                    -- procurement department / category owner
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS cdp_score text CHECK (cdp_score IN ('A', 'A-', 'B', 'B-', 'C', 'C-', 'D', 'D-', 'F'));
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS cdp_year int CHECK (cdp_year BETWEEN 2000 AND 2100);
-- declared target: { reductionPct, baseYear, targetYear, netZeroYear, scopes, source }
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS target jsonb;
ALTER TABLE supplier DROP CONSTRAINT IF EXISTS supplier_origin_check;
ALTER TABLE supplier ADD CONSTRAINT supplier_origin_check CHECK (origin IN ('manual', 'upload', 'api', 'list'));

-- the customer chose to show the supplier the customer's own estimate of the supplier's emissions in its report
ALTER TABLE supplier_request ADD COLUMN IF NOT EXISTS share_estimate boolean NOT NULL DEFAULT false;

-- SBTi "companies taking action" list (public; the same for every company on the platform)
CREATE TABLE IF NOT EXISTS sbti_company (
  id               serial PRIMARY KEY,
  name             text NOT NULL,
  norm             text NOT NULL,                  -- normalised name (legal forms removed), for matching
  isin             text,
  lei              text,
  location         text,
  region           text,
  sector           text,
  near_status      text,                           -- near-term: Targets set / Committed / Commitment removed …
  near_class       text,                           -- 1.5°C / Well-below 2°C / 2°C
  near_year        int,                            -- near-term target year, when given
  net_zero_status  text,
  net_zero_year    int,
  published        text,
  imported_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sbti_company_norm ON sbti_company (norm);
CREATE TABLE IF NOT EXISTS sbti_import (
  id          serial PRIMARY KEY,
  filename    text,
  rows        int NOT NULL,
  imported_by text,
  demo        boolean NOT NULL DEFAULT false,
  imported_at timestamptz NOT NULL DEFAULT now()
);

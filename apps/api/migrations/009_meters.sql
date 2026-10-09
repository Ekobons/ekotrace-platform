-- Meters: readings arrive from another system through the API (or are pasted /
-- uploaded), hourly, daily, weekly, monthly or irregular. Readings are turned
-- into one entry per calendar month (in the company's time zone), with the
-- coverage of the month and any gaps or resets shown on the entry.

ALTER TABLE tenant ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Dubai';

CREATE TABLE IF NOT EXISTS meter (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  facility_id   uuid NOT NULL REFERENCES org_node(id),
  name          text NOT NULL,
  serial        text,
  -- the meter's id in the sending system (BMS, utility portal, IoT platform); readings are matched by it
  external_id   text NOT NULL,
  -- cumulative: register / index reading (consumption = difference); interval: consumption per interval
  reading_type  text NOT NULL CHECK (reading_type IN ('cumulative','interval')),
  frequency     text NOT NULL CHECK (frequency IN ('hour','day','week','month','irregular')),
  unit          text NOT NULL REFERENCES unit(code),
  multiplier    numeric(20,8) NOT NULL DEFAULT 1 CHECK (multiplier > 0),   -- CT ratio / pulse value
  rollover      numeric(30,6) CHECK (rollover > 0),                       -- register maximum before it returns to 0
  item_id       int NOT NULL REFERENCES item(id),
  -- the rest of the entry (supplier, grid region, fuel, waste process…), as entered in Add data
  template      jsonb NOT NULL DEFAULT '{}',
  gap_fill      text NOT NULL DEFAULT 'prorate' CHECK (gap_fill IN ('prorate','none')),
  auto_entries  boolean NOT NULL DEFAULT true,
  active        boolean NOT NULL DEFAULT true,
  note          text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, external_id)
);
CREATE INDEX IF NOT EXISTS meter_facility ON meter(facility_id);

CREATE TABLE IF NOT EXISTS meter_reading (
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  meter_id     uuid NOT NULL REFERENCES meter(id) ON DELETE CASCADE,
  ts           timestamptz NOT NULL,              -- time of the reading (end of the interval)
  from_ts      timestamptz,                       -- interval readings: start of the interval, when sent
  value        numeric(30,6) NOT NULL,
  source       text NOT NULL DEFAULT 'api' CHECK (source IN ('api','upload','manual')),
  received_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (meter_id, ts),
  CHECK (from_ts IS NULL OR from_ts < ts)
);

-- Keys for systems that send readings. Only the SHA-256 of a key is stored; it is shown once.
CREATE TABLE IF NOT EXISTS api_key (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name          text NOT NULL,
  prefix        text NOT NULL,
  key_hash      text NOT NULL UNIQUE,
  scopes        text[] NOT NULL DEFAULT '{meter_readings}',
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

ALTER TABLE activity ADD COLUMN IF NOT EXISTS meter_id uuid REFERENCES meter(id);
CREATE UNIQUE INDEX IF NOT EXISTS activity_meter_month ON activity(meter_id, period_start) WHERE meter_id IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['meter','meter_reading','api_key'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.platform', true) = 'on')$p$, t);
  END LOOP;
END $$;

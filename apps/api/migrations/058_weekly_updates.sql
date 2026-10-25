-- Weekly updates (platform admin): what the weekly research run found — new emission factor
-- releases, CBAM changes, US CPI, monthly exchange rates, tech and market news — and draft
-- LinkedIn posts. The run commits data/updates/<YYYY-MM-DD>.json; the server loads the files
-- at every start. Nothing is applied until a platform admin clicks Apply (exchange rates, CPI)
-- or marks a manual item done. Platform-wide: no tenant, read and written by platform admins only.
CREATE TABLE IF NOT EXISTS platform_update (
  key          text PRIMARY KEY CHECK (key ~ '^[a-z0-9][a-z0-9._-]{1,79}$'),
  week         date NOT NULL,
  stream       text NOT NULL CHECK (stream IN ('factors','cbam','cpi','fx','tech','market','regulation')),
  title        text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  detail       text NOT NULL DEFAULT '' CHECK (length(detail) <= 4000),
  impact       text NOT NULL DEFAULT '' CHECK (length(impact) <= 2000),
  published    date,
  sources      jsonb NOT NULL DEFAULT '[]'::jsonb,
  apply        jsonb,                                  -- {kind:'fx'|'cpi', rows:[…]} or null (manual)
  where_to     text NOT NULL DEFAULT '' CHECK (length(where_to) <= 300),   -- screen to use for a manual item
  status       text NOT NULL DEFAULT 'new' CHECK (status IN ('new','applied','done','dismissed')),
  decided_by   uuid REFERENCES app_user(id) ON DELETE SET NULL,
  decided_name text,
  decided_at   timestamptz,
  note         text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  loaded_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_update_week ON platform_update (week DESC, stream);

CREATE TABLE IF NOT EXISTS platform_update_post (
  key          text PRIMARY KEY CHECK (key ~ '^[a-z0-9][a-z0-9._-]{1,79}$'),
  week         date NOT NULL,
  title        text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  body         text NOT NULL CHECK (length(body) BETWEEN 2 AND 4000),
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','posted')),
  decided_by   uuid REFERENCES app_user(id) ON DELETE SET NULL,
  decided_name text,
  decided_at   timestamptz,
  loaded_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_update_post_week ON platform_update_post (week DESC);

-- Which weekly files have been loaded (and their checksum, so a corrected file is loaded again).
CREATE TABLE IF NOT EXISTS platform_update_file (
  name       text PRIMARY KEY,
  sha256     text NOT NULL,
  week       date NOT NULL,
  summary    text NOT NULL DEFAULT '',
  loaded_at  timestamptz NOT NULL DEFAULT now()
);

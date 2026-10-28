-- UAE MRV: the figures frozen when a report is submitted (GWP set, IPCC defaults or facility details changing later
-- do not change a submitted report), and the inventory streams people removed (not brought back by a refresh).
SELECT set_config('app.platform', 'on', true);
ALTER TABLE mrv_year ADD COLUMN IF NOT EXISTS frozen jsonb;
ALTER TABLE mrv_year ADD COLUMN IF NOT EXISTS dismissed text[] NOT NULL DEFAULT '{}';

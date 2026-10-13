-- Approval levels (as in the prototype): level 1 by the facility manager (or sub-group admin);
-- optionally a level-2 approval by an admin or the super admin — a different person — for entries
-- of at least a number of tonnes, or always for chosen categories. The quantity check limit (± % vs
-- the 6-month average) is set here too.
SELECT set_config('app.platform', 'on', true);

ALTER TABLE tenant ADD COLUMN IF NOT EXISTS approval jsonb NOT NULL DEFAULT '{"l2": false, "minT": 100, "cats": [], "checkPct": 35}';
ALTER TABLE activity ADD COLUMN IF NOT EXISTS approval_stage text CHECK (approval_stage IN ('L2'));   -- null = level 1 (or one level)
ALTER TABLE activity ADD COLUMN IF NOT EXISTS l1_by text;
ALTER TABLE activity ADD COLUMN IF NOT EXISTS l1_at timestamptz;

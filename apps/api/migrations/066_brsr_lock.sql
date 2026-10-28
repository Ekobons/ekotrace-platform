-- BRSR Core: review by user id (names change and repeat), the value reviewed, and the figures from entries frozen
-- when a year is set Final (approving a back-dated entry no longer changes a final year).
SELECT set_config('app.platform', 'on', true);

ALTER TABLE brsr_value  ADD COLUMN IF NOT EXISTS updated_by uuid;          -- app_user who last changed the value
ALTER TABLE brsr_value  ADD COLUMN IF NOT EXISTS reviewed_by uuid;         -- app_user who reviewed it
ALTER TABLE brsr_value  ADD COLUMN IF NOT EXISTS reviewed_value numeric;   -- the value shown when it was reviewed
ALTER TABLE brsr_partner ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE brsr_report ADD COLUMN IF NOT EXISTS frozen jsonb;             -- figures from entries when set Final; NULL otherwise

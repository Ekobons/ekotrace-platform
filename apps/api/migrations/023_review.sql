-- Enter → Review → Approved (Add data).
--
-- An entry is saved as a draft, submitted for approval, then approved or sent back with a note by
-- someone who may approve the facility — never by the person who entered or submitted it.
-- Approved entries count in the dashboards and reports; drafts and entries waiting count only in
-- the "include pending" views.
SELECT set_config('app.platform', 'on', true);

ALTER TABLE activity ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE activity ADD COLUMN IF NOT EXISTS submitted_by text;
ALTER TABLE activity ADD COLUMN IF NOT EXISTS reviewed_at  timestamptz;
ALTER TABLE activity ADD COLUMN IF NOT EXISTS reviewed_by  text;
ALTER TABLE activity ADD COLUMN IF NOT EXISTS review_note  text;    -- why it was sent back
CREATE INDEX IF NOT EXISTS activity_facility_status ON activity(facility_id, status);

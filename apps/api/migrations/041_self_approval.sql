-- Self-approval (company setting, off by default): a super admin, admin or manager may approve their own entry
-- when the company allows it, with a note confirming they checked it against its evidence. Marked self-reviewed.
ALTER TABLE activity ADD COLUMN IF NOT EXISTS self_review_note text;

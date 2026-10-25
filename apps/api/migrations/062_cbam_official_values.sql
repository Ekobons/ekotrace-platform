-- The Commission's published default values and benchmarks, loaded as published:
--   default values per country (direct, indirect, total; the production route behind the benchmark),
--   "Other countries and territories" (stored with no country), the highest values of Annex IV (kind 'highest'),
--   benchmarks of column A (actual emissions) and column B (default values) with their production route.
-- Import lines may carry a 10-digit TARIC code (white and grey clinker have different default values).

ALTER TABLE cbam_reference ADD COLUMN IF NOT EXISTS direct      numeric;
ALTER TABLE cbam_reference ADD COLUMN IF NOT EXISTS indirect    numeric;
ALTER TABLE cbam_reference ADD COLUMN IF NOT EXISTS basis       text;
ALTER TABLE cbam_reference ADD COLUMN IF NOT EXISTS description text;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = 'cbam_reference'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%kind%' LOOP
    EXECUTE format('ALTER TABLE cbam_reference DROP CONSTRAINT %I', r.conname);
  END LOOP;
  FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = 'cbam_import'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%cn ~%' LOOP
    EXECUTE format('ALTER TABLE cbam_import DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE cbam_reference ADD CONSTRAINT cbam_reference_kind_check CHECK (kind IN ('default', 'benchmark', 'price', 'highest'));
ALTER TABLE cbam_reference ADD CONSTRAINT cbam_reference_basis_check CHECK (basis IS NULL OR basis IN ('A', 'B'));
ALTER TABLE cbam_import ADD CONSTRAINT cbam_import_cn_check CHECK (cn ~ '^[0-9]{4,10}$');

CREATE INDEX IF NOT EXISTS cbam_reference_kc ON cbam_reference (kind, country);

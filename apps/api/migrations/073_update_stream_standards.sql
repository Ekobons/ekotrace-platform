-- Weekly updates: a stream of its own for changes to accounting standards (GHG Protocol, ISO 14064/14067, SBTi, PCAF).
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = 'platform_update'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%stream%' LOOP
    EXECUTE format('ALTER TABLE platform_update DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE platform_update ADD CONSTRAINT platform_update_stream_check CHECK (stream IN ('factors','cbam','cpi','fx','tech','market','regulation','standards'));

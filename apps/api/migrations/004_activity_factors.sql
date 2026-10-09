-- CO2e emission factor used for each part of an entry (Scope 1, WTT, biogenic, memo),
-- stored so a saved entry shows quantity × factor = result. Older entries keep '[]'
-- and the screens derive the factor from total ÷ quantity.
ALTER TABLE activity ADD COLUMN IF NOT EXISTS factors jsonb NOT NULL DEFAULT '[]';

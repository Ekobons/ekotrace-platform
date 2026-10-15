-- Documents kept on a supplier's record by the company's staff (sustainability report, CDP response, EPD,
-- contract clause…): [{ id, filename, kind, size, at, by }]. Files are documents of kind 'supplier_evidence'.
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS documents jsonb NOT NULL DEFAULT '[]';

-- Company logo (Organisation → Company details), printed on reports. PNG or JPEG, stored as a document.
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS logo_id uuid REFERENCES document(id) ON DELETE SET NULL;

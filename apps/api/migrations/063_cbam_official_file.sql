-- The Commission's CBAM files shipped in data/cbam/official, loaded once each at start-up (by content hash).
CREATE TABLE IF NOT EXISTS cbam_official_file (
  sha256    text PRIMARY KEY,
  filename  text NOT NULL,
  kind      text NOT NULL,
  source    text NOT NULL,
  rows      int NOT NULL,
  loaded_at timestamptz NOT NULL DEFAULT now()
);

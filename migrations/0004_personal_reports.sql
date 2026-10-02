-- Existing contributors explicitly chose aggregate uploads. New personal reports opt out.
ALTER TABLE contributors ADD COLUMN in_aggregate INTEGER NOT NULL DEFAULT 1 CHECK (in_aggregate IN (0, 1));

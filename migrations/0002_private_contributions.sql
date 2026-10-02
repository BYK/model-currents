-- Preserve links already shared before private uploads were introduced.
ALTER TABLE contributors ADD COLUMN published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1));

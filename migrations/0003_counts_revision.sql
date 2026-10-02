ALTER TABLE contributors ADD COLUMN report_revision INTEGER NOT NULL DEFAULT 0;

-- A report can retain weeks from earlier uploads. Apply the same limits to the
-- complete stored report, atomically, while leaving oversized old rows intact.
CREATE TRIGGER limit_contributor_cells BEFORE INSERT ON weekly_counts
WHEN (SELECT COUNT(*) FROM weekly_counts WHERE contributor_id = NEW.contributor_id) >= 2048
    OR (NOT EXISTS (SELECT 1 FROM weekly_counts WHERE contributor_id = NEW.contributor_id AND week = NEW.week)
        AND (SELECT COUNT(DISTINCT week) FROM weekly_counts WHERE contributor_id = NEW.contributor_id) >= 520)
BEGIN
    SELECT RAISE(ABORT, 'Stored weekly count limit exceeded');
END;

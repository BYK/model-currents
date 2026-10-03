-- Keep historical start/switch counts readable, but never add them to active-day totals.
ALTER TABLE contributors ADD COLUMN metric_version INTEGER NOT NULL DEFAULT 1 CHECK (metric_version IN (1, 2));
-- Transaction-local claim for a complete v1 -> v2 replacement; cleared before commit.
ALTER TABLE contributors ADD COLUMN migration_nonce TEXT;
CREATE INDEX contributors_aggregate_metric_idx ON contributors(in_aggregate, metric_version);

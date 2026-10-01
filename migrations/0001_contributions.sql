CREATE TABLE contributors (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE weekly_counts (
    contributor_id TEXT NOT NULL REFERENCES contributors(id) ON DELETE CASCADE,
    week TEXT NOT NULL,
    model TEXT NOT NULL,
    count INTEGER NOT NULL CHECK (count BETWEEN 1 AND 10000),
    PRIMARY KEY (contributor_id, week, model)
);

CREATE INDEX weekly_counts_by_week_model ON weekly_counts (week, model);

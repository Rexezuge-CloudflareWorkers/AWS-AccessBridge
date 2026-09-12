-- Migration 0028: Background Task Run Visibility
-- Adds a unified run log for all background task executions, mirroring the
-- Mail-Otter `background_task_runs` table (minus the per-application column,
-- since AccessBridge tasks run globally, not per application).

CREATE TABLE IF NOT EXISTS background_task_runs (
    run_id TEXT PRIMARY KEY,
    task_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    items_processed INTEGER NOT NULL DEFAULT 0,
    items_failed INTEGER NOT NULL DEFAULT 0,
    summary TEXT,
    details TEXT,
    error_message TEXT,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    created_at INTEGER NOT NULL,
    CHECK (status IN ('running', 'success', 'partial_success', 'error', 'skipped'))
);

CREATE INDEX IF NOT EXISTS idx_btr_type_started
    ON background_task_runs (task_type, started_at DESC);
